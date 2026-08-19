import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { extractResponsesText } from "../src/extract-responses-text.mjs";

const TARGET_PROVIDER = "codex-local";
const TARGET_API = "openai-responses";
const TOOL_NAME = "web_search";
const DEFAULT_ENABLED = true;
const SEARCH_CONTEXT_SIZE = "medium";
const CONFIG_PATH = join(
	process.env.USERPROFILE || process.env.HOME || process.cwd(),
	".pi",
	"web-search.json",
);

const SEARCH_TOOL_PARAMETERS = Type.Object({
	query: Type.String({ description: "The current-information web search query" }),
});

type JsonObject = Record<string, unknown>;

type SearchParams = {
	query: string;
};

const NESTED_SEARCH_INSTRUCTIONS = [
	"Use the native web search tool to answer the original user's request.",
	"Return only the search result for the parent model.",
	"Follow the original user's language, scope, count, and requested output format.",
	"Preserve exact page titles and complete URLs when the user asks for them or when they are useful.",
	"Do not mention this nested search call or add planning commentary.",
	"Do not invent sources or URLs.",
].join("\n");

const SEARCH_TOOL_GUIDANCE = [
	"Web search routing for this session:",
	"- Use the plugin-owned `web_search` tool when the user asks for current or web-researched information.",
	"- The tool calls the configured codex-local OpenAI Responses endpoint and uses native Responses `web_search` internally.",
	"- Do not use bash, Python, curl, urllib, browser tools, or API keys to search the web.",
	"- Use the web_search result as research context and answer the original user naturally.",
	"- If web_search is unavailable or fails, report that directly instead of substituting another search path.",
].join("\n");

let enabled = DEFAULT_ENABLED;

function isJsonObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readConfig(): JsonObject {
	try {
		const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return isJsonObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function readPersistentEnabled(): boolean {
	const native = readConfig().nativeWebSearch;
	return isJsonObject(native) && typeof native.enabled === "boolean"
		? native.enabled
		: DEFAULT_ENABLED;
}

function persistEnabled(value: boolean): string | undefined {
	try {
		const config = readConfig();
		const current = isJsonObject(config.nativeWebSearch) ? config.nativeWebSearch : {};
		config.nativeWebSearch = { ...current, enabled: value };
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function isTargetModel(ctx: ExtensionContext): boolean {
	return ctx.model?.provider === TARGET_PROVIDER && ctx.model.api === TARGET_API;
}

function textFromUserMessage(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type?: unknown; text?: unknown } => isJsonObject(part))
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function latestUserRequest(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message?.role !== "user") continue;
		const text = textFromUserMessage(entry.message.content).trim();
		if (text) return text;
	}
	return "";
}

function updateStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(
		"openai-web-search",
		enabled ? "host-side native web-search: on" : undefined,
	);
}

function applyToolActivation(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const active = pi.getActiveTools();
	const next = enabled && isTargetModel(ctx)
		? Array.from(new Set([...active, TOOL_NAME]))
		: active.filter((name) => name !== TOOL_NAME);
	if (next.length !== active.length || next.some((name, index) => name !== active[index])) {
		pi.setActiveTools(next);
	}
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	const expected = name.toLowerCase();
	return Object.keys(headers).some((key) => key.toLowerCase() === expected);
}

function responsesEndpoint(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	return normalized.endsWith("/responses") ? normalized : `${normalized}/responses`;
}

async function readResponsesBody(response: Response): Promise<JsonObject> {
	const body = await response.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new Error("codex-local returned a non-JSON Responses payload");
	}
	if (!isJsonObject(parsed)) {
		throw new Error("codex-local returned an invalid Responses payload");
	}
	return parsed;
}

async function runNativeSearch(
	query: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<JsonObject> {
	if (!isTargetModel(ctx) || !ctx.model) {
		throw new Error("web_search requires the codex-local openai-responses model");
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok) throw new Error(auth.error);

	const baseUrl = auth.baseUrl ?? ctx.model.baseUrl;
	if (!baseUrl) throw new Error("No base URL configured for codex-local");

	const headers: Record<string, string> = {
		"content-type": "application/json",
		...(auth.headers ?? {}),
	};
	if (auth.apiKey && !hasHeader(headers, "authorization")) {
		headers.authorization = `Bearer ${auth.apiKey}`;
	}

	const originalRequest = latestUserRequest(ctx);
	const input = [
		originalRequest ? `Original user request:\n${originalRequest}` : "",
		`Search query:\n${query}`,
		NESTED_SEARCH_INSTRUCTIONS,
	]
		.filter(Boolean)
		.join("\n\n");

	const response = await fetch(responsesEndpoint(baseUrl), {
		method: "POST",
		headers,
		signal,
		body: JSON.stringify({
			model: ctx.model.id,
			input,
			tools: [{ type: "web_search", search_context_size: SEARCH_CONTEXT_SIZE }],
			stream: false,
			store: false,
		}),
	});

	const payload = await readResponsesBody(response);
	if (!response.ok) {
		const error = isJsonObject(payload.error) ? payload.error : undefined;
		const message = error && typeof error.message === "string"
			? error.message
			: `HTTP ${response.status}`;
		throw new Error(`codex-local web_search failed: ${message}`);
	}
	return payload;
}

export default function openaiWebSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "web_search",
		description:
			"Search the web through the configured codex-local OpenAI Responses endpoint and return the search result to the parent model.",
		promptSnippet: "Search current information",
		promptGuidelines: [
			"Use web_search for current information instead of bash, Python, curl, browser tools, or external search APIs.",
			"Use the returned web_search result as context for the user's requested answer format.",
		],
		parameters: SEARCH_TOOL_PARAMETERS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!enabled) throw new Error("web_search is disabled; use /web-search on to enable it");
			const query = String((params as SearchParams).query ?? "").trim();
			if (!query) throw new Error("web_search requires a non-empty query");

			const response = await runNativeSearch(query, ctx, signal);
			const text = extractResponsesText(response);
			if (!text.trim()) throw new Error("web_search returned no textual result");

			return {
				content: [{ type: "text", text }],
				details: {
					query,
					provider: ctx.model?.provider ?? TARGET_PROVIDER,
					model: ctx.model?.id ?? "unknown",
				},
			};
		},
	});

	pi.registerCommand("web-search", {
		description: "开关并持久化 codex-local 的 native web_search：on、off 或 status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "on") {
				enabled = true;
				const error = persistEnabled(true);
				applyToolActivation(pi, ctx);
				updateStatus(ctx);
				ctx.ui.notify(
					error
						? `Native web_search 已开启，但保存配置失败：${error}`
						: "Native web_search 已开启，并已保存到 ~/.pi/web-search.json",
					error ? "warning" : "info",
				);
				return;
			}

			if (action === "off") {
				enabled = false;
				const error = persistEnabled(false);
				applyToolActivation(pi, ctx);
				updateStatus(ctx);
				ctx.ui.notify(
					error
						? `Native web_search 已关闭，但保存配置失败：${error}`
						: "Native web_search 已关闭，并已保存到 ~/.pi/web-search.json",
					error ? "warning" : "info",
				);
				return;
			}

			if (!action || action === "status") {
				ctx.ui.notify(
					`Native web_search 当前为 ${enabled ? "开启" : "关闭"}（持久化配置）`,
					"info",
				);
				return;
			}

			ctx.ui.notify("用法：/web-search on|off|status", "warning");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		enabled = readPersistentEnabled();
		applyToolActivation(pi, ctx);
		updateStatus(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		applyToolActivation(pi, ctx);
		updateStatus(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!enabled || !isTargetModel(ctx)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${SEARCH_TOOL_GUIDANCE}`,
		};
	});
}
