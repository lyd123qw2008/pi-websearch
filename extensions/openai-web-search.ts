import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { extractResponsesText } from "../src/extract-responses-text.mjs";
import { consumeSseResponse } from "../src/responses-sse.mjs";

const TARGET_PROVIDER = "codex-local";
const TARGET_API = "openai-responses";
const TOOL_NAME = "web_search";
const DEFAULT_ENABLED = true;
const DEFAULT_STREAMING = true;
const DEFAULT_STATUS_DISPLAY = "switch";
const SEARCH_CONTEXT_SIZE = "medium";

const STATUS_DISPLAY_OPTIONS = [
	{ value: "switch", name: "只显示开关" },
	{ value: "mode", name: "显示开关和模式" },
	{ value: "verbose", name: "显示详细状态" },
	{ value: "hidden", name: "隐藏状态栏" },
] as const;
type StatusDisplay = (typeof STATUS_DISPLAY_OPTIONS)[number]["value"];
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

type SearchUpdate = {
	content: Array<{ type: "text"; text: string }>;
	details: JsonObject;
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
let streaming = DEFAULT_STREAMING;
let statusDisplay: StatusDisplay = DEFAULT_STATUS_DISPLAY;

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

function readPersistentStreaming(): boolean {
	const native = readConfig().nativeWebSearch;
	return isJsonObject(native) && typeof native.stream === "boolean"
		? native.stream
		: DEFAULT_STREAMING;
}

function isStatusDisplay(value: unknown): value is StatusDisplay {
	return STATUS_DISPLAY_OPTIONS.some((option) => option.value === value);
}

function readPersistentStatusDisplay(): StatusDisplay {
	const native = readConfig().nativeWebSearch;
	return isJsonObject(native) && isStatusDisplay(native.statusDisplay)
		? native.statusDisplay
		: DEFAULT_STATUS_DISPLAY;
}

function statusDisplayName(value: StatusDisplay): string {
	return STATUS_DISPLAY_OPTIONS.find((option) => option.value === value)?.name ?? value;
}

function formatStatus(display: StatusDisplay, enabledValue: boolean, streamingValue: boolean): string | undefined {
	if (display === "hidden") return undefined;
	const state = enabledValue ? "on" : "off";
	if (display === "switch") return `web-search: ${state}`;
	if (display === "mode") return `web-search: ${state} · ${streamingValue ? "stream" : "buffered"}`;
	return `host-side native web-search: ${state} (${streamingValue ? "streaming" : "buffered"})`;
}

function statusDisplayOptionLabel(value: StatusDisplay): string {
	const preview = formatStatus(value, enabled, streaming) ?? "（不显示）";
	return `${statusDisplayName(value)} — ${preview}`;
}

function persistNativeWebSearch(update: JsonObject): string | undefined {
	try {
		const config = readConfig();
		const current = isJsonObject(config.nativeWebSearch) ? config.nativeWebSearch : {};
		config.nativeWebSearch = { ...current, ...update };
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function persistEnabled(value: boolean): string | undefined {
	return persistNativeWebSearch({ enabled: value });
}

function persistStreaming(value: boolean): string | undefined {
	return persistNativeWebSearch({ stream: value });
}

function persistStatusDisplay(value: StatusDisplay): string | undefined {
	return persistNativeWebSearch({ statusDisplay: value });
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
		formatStatus(statusDisplay, enabled, streaming),
	);
}

function detailedStatus(ctx: ExtensionContext): string {
	const model = ctx.model
		? `${ctx.model.provider}/${ctx.model.id} (${ctx.model.api})`
		: "未选择";
	return [
		`Native web_search：${enabled ? "开启" : "关闭"}（持久化配置）`,
		`Responses streaming：${streaming ? "开启" : "关闭"}（持久化配置）`,
		`状态栏显示：${statusDisplayName(statusDisplay)}（${statusDisplay}，持久化配置）`,
		`状态栏预览：${formatStatus(statusDisplay, enabled, streaming) ?? "隐藏"}`,
		`当前模型：${model}`,
		`目标模型：${TARGET_PROVIDER}/${TARGET_API}`,
		`Search context：${SEARCH_CONTEXT_SIZE}`,
		`配置文件：${CONFIG_PATH}`,
	].join("\n");
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

function responseEventError(data: unknown): string {
	const root = isJsonObject(data) ? data : {};
	const response = isJsonObject(root.response) ? root.response : root;
	const error = isJsonObject(response.error) ? response.error : undefined;
	return error && typeof error.message === "string"
		? error.message
		: typeof root.message === "string"
			? root.message
			: "codex-local streaming Responses request failed";
}

function searchQueryFromEvent(data: unknown): string | undefined {
	if (!isJsonObject(data)) return undefined;
	const item = isJsonObject(data.item) ? data.item : undefined;
	const outputItem = isJsonObject(data.output_item) ? data.output_item : undefined;
	const action = isJsonObject(data.action) ? data.action : undefined;
	const itemAction = item && isJsonObject(item.action) ? item.action : undefined;
	const outputAction = outputItem && isJsonObject(outputItem.action) ? outputItem.action : undefined;
	for (const candidate of [
		data.query,
		action?.query,
		itemAction?.query,
		outputAction?.query,
	]) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	return undefined;
}

function progressForResponseEvent(eventName: string, data: unknown): string | undefined {
	const item = isJsonObject(data) && isJsonObject(data.item) ? data.item : undefined;
	const isSearchItem = item?.type === "web_search_call" || eventName.includes("web_search_call");
	if (!isSearchItem) return undefined;

	const query = searchQueryFromEvent(data);
	if (eventName.endsWith(".completed")) {
		return query ? `已搜索网页：${query}` : "已完成网页搜索";
	}
	return query ? `正在搜索网页：${query}` : "正在搜索网页…";
}

function textFromResponseValue(value: unknown): string {
	if (!isJsonObject(value)) return "";
	if (typeof value.output_text === "string") return value.output_text;

	const chunks: string[] = [];
	if (Array.isArray(value.content)) {
		for (const part of value.content) {
			if (!isJsonObject(part)) continue;
			if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
				chunks.push(part.text);
			}
		}
	}
	if (Array.isArray(value.output)) {
		for (const item of value.output) {
			if (isJsonObject(item) && item.type === "message") chunks.push(textFromResponseValue(item));
		}
	}
	return chunks.join("");
}

async function readStreamingResponses(
	response: Response,
	signal: AbortSignal | undefined,
	onUpdate?: (update: SearchUpdate) => void,
): Promise<JsonObject> {
	let completed: JsonObject | undefined;
	let outputText = "";
	const completedItemTexts = new Set<string>();
	let lastProgress: string | undefined;
	let lastEventType = "";

	onUpdate?.({
		content: [{ type: "text", text: "正在连接 native web_search…" }],
		details: { phase: "connecting", streaming: true },
	});

	await consumeSseResponse(response, ({ event, data }) => {
		const eventType = isJsonObject(data) && typeof data.type === "string"
			? data.type
			: event;
		lastEventType = eventType;
		if (eventType === "response.failed" || eventType === "error") {
			throw new Error(responseEventError(data));
		}

		if (isJsonObject(data)) {
			if (eventType === "response.output_text.delta" && typeof data.delta === "string") {
				outputText += data.delta;
			}
			if (eventType === "response.output_text.done" && !outputText && typeof data.text === "string") {
				outputText = data.text;
			}
			if (eventType === "response.output_item.done" || eventType === "response.content_part.done") {
				const item = isJsonObject(data.item) ? data.item : isJsonObject(data.part) ? data.part : data;
				const itemText = textFromResponseValue(item);
				if (itemText) completedItemTexts.add(itemText);
			}
			if (eventType === "response.completed") {
				const value = isJsonObject(data.response) ? data.response : data;
				completed = value;
			}
		}

		const progress = progressForResponseEvent(eventType, data);
		if (progress && progress !== lastProgress) {
			lastProgress = progress;
			onUpdate?.({
				content: [{ type: "text", text: progress }],
				details: { phase: "searching", event: eventType, streaming: true },
			});
		}
	});

	const payload = completed ?? {};
	const fallbackText = [...completedItemTexts].join("");
	if (outputText && (typeof payload.output_text !== "string" || !payload.output_text.trim())) {
		payload.output_text = outputText;
	} else if (!outputText && fallbackText && typeof payload.output_text !== "string") {
		payload.output_text = fallbackText;
	}
	if (!completed && !outputText && !fallbackText) {
		throw new Error(`codex-local streaming Responses ended without a completed response (last event: ${lastEventType || "unknown"})`);
	}
	return payload;
}

async function runNativeSearch(
	query: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	onUpdate?: (update: SearchUpdate) => void,
	useStreaming = streaming,
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
			stream: useStreaming,
			store: false,
		}),
	});

	if (!response.ok) {
		const payload = await readResponsesBody(response);
		const error = isJsonObject(payload.error) ? payload.error : undefined;
		const message = error && typeof error.message === "string"
			? error.message
			: `HTTP ${response.status}`;
		throw new Error(`codex-local web_search failed: ${message}`);
	}
	return useStreaming
		? readStreamingResponses(response, signal, onUpdate)
		: readResponsesBody(response);
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
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!enabled) throw new Error("web_search is disabled; use /web-search on to enable it");
			const query = String((params as SearchParams).query ?? "").trim();
			if (!query) throw new Error("web_search requires a non-empty query");

			const useStreaming = streaming;
			const response = await runNativeSearch(query, ctx, signal, onUpdate, useStreaming);
			const text = extractResponsesText(response);
			if (!text.trim()) throw new Error("web_search returned no textual result");

			return {
				content: [{ type: "text", text }],
				details: {
					query,
					provider: ctx.model?.provider ?? TARGET_PROVIDER,
					model: ctx.model?.id ?? "unknown",
					stream: useStreaming,
				},
			};
		},
		renderCall(args, theme) {
			const query = String((args as SearchParams).query ?? "");
			return new Text(
				`${theme.fg("toolTitle", theme.bold("web_search "))}${theme.fg("accent", query)}`,
				0,
				0,
			);
		},
	});

	pi.registerCommand("web-search", {
		description: "配置 codex-local 的 native web_search：on、off、stream、display 或 status",
		handler: async (args, ctx) => {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const action = parts[0] ?? "";
			const value = parts[1] ?? "";

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

			if (action === "display") {
				if (value) {
					const next = value === "compact" ? "switch" : value === "standard" ? "mode" : value === "detail" ? "verbose" : value;
					if (!isStatusDisplay(next)) {
						ctx.ui.notify("用法：/web-search display [switch|mode|verbose|hidden]", "warning");
						return;
					}
					statusDisplay = next;
					const error = persistStatusDisplay(statusDisplay);
					updateStatus(ctx);
					ctx.ui.notify(
						error
							? `状态栏显示已切换为“${statusDisplayName(statusDisplay)}”，但保存配置失败：${error}`
							: `状态栏显示已切换为“${statusDisplayName(statusDisplay)}”，已保存到 ~/.pi/web-search.json`,
						error ? "warning" : "info",
					);
					return;
				}

				if (!ctx.hasUI) {
					ctx.ui.notify("当前模式不支持选择栏。用法：/web-search display [switch|mode|verbose|hidden]", "warning");
					return;
				}

				const selected = await ctx.ui.select(
					"选择 web-search 状态栏显示内容",
					STATUS_DISPLAY_OPTIONS.map((option) => statusDisplayOptionLabel(option.value)),
				);
				if (!selected) return;
				const selectedOption = STATUS_DISPLAY_OPTIONS.find(
					(option) => statusDisplayOptionLabel(option.value) === selected,
				);
				if (!selectedOption) return;
				statusDisplay = selectedOption.value;
				const error = persistStatusDisplay(statusDisplay);
				updateStatus(ctx);
				ctx.ui.notify(
					error
						? `状态栏显示已切换为“${statusDisplayName(statusDisplay)}”，但保存配置失败：${error}`
						: `状态栏显示已切换为“${statusDisplayName(statusDisplay)}”，已保存到 ~/.pi/web-search.json`,
					error ? "warning" : "info",
				);
				return;
			}

			if (action === "stream") {
				if (value === "on" || value === "off") {
					streaming = value === "on";
					const error = persistStreaming(streaming);
					updateStatus(ctx);
					ctx.ui.notify(
						error
							? `Responses streaming 已${streaming ? "开启" : "关闭"}，但保存配置失败：${error}`
							: `Responses streaming 已${streaming ? "开启" : "关闭"}，已保存到 ~/.pi/web-search.json`,
						error ? "warning" : "info",
					);
					return;
				}

				if (!value || value === "status") {
					ctx.ui.notify(
						`Responses streaming 当前为 ${streaming ? "开启" : "关闭"}（持久化配置）`,
						"info",
					);
					return;
				}
			}

			if (!action || action === "status") {
				ctx.ui.notify(detailedStatus(ctx), "info");
				return;
			}

			ctx.ui.notify(
				"用法：/web-search on|off|stream on|stream off|display|status",
				"warning",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		enabled = readPersistentEnabled();
		streaming = readPersistentStreaming();
		statusDisplay = readPersistentStatusDisplay();
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
