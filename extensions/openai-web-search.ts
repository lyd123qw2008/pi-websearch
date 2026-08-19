import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "codex-local";
const TARGET_API = "openai-responses";
const DEFAULT_ENABLED = true;
const CONFIG_PATH = join(
	process.env.USERPROFILE || process.env.HOME || process.cwd(),
	".pi",
	"web-search.json",
);

// OpenAI Responses API hosted web search tool. It is deliberately not added to
// models.json; this extension reads the persistent nativeWebSearch setting below.
const WEB_SEARCH_TOOL = {
	type: "web_search",
	search_context_size: "medium",
};

const NATIVE_WEB_SEARCH_GUIDANCE = [
	"Web search routing for this session:",
	"- When the user asks for current or web-researched information, use the available `web_search` capability directly.",
	"- Do not use bash, Python, curl, urllib, browser tools, or API keys to search the web.",
	"- If web search is unavailable or fails, report that directly instead of substituting another search path.",
].join("\n");

let enabled = DEFAULT_ENABLED;

type JsonObject = Record<string, unknown>;

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
	const config = readConfig();
	const native = config.nativeWebSearch;
	if (isJsonObject(native) && typeof native.enabled === "boolean") {
		return native.enabled;
	}
	return DEFAULT_ENABLED;
}

function persistEnabled(value: boolean): string | undefined {
	try {
		const config = readConfig();
		const current = isJsonObject(config.nativeWebSearch) ? config.nativeWebSearch : {};
		config.nativeWebSearch = {
			...current,
			enabled: value,
		};
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

function updateStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus("openai-web-search", enabled ? "native web-search: on" : undefined);
}

function toolType(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const type = (value as { type?: unknown }).type;
	return typeof type === "string" ? type : undefined;
}

export default function openaiWebSearchExtension(pi: ExtensionAPI): void {
	pi.registerCommand("web-search", {
		description: "开关并持久化 codex-local 的 OpenAI Responses web_search：on、off 或 status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "on") {
				enabled = true;
				const error = persistEnabled(true);
				updateStatus(ctx);
				ctx.ui.notify(
					error
						? `OpenAI 原生 web_search 已开启，但保存配置失败：${error}`
						: "OpenAI 原生 web_search 已开启，并已保存到 ~/.pi/web-search.json",
					error ? "warning" : "info",
				);
				return;
			}

			if (action === "off") {
				enabled = false;
				const error = persistEnabled(false);
				updateStatus(ctx);
				ctx.ui.notify(
					error
						? `OpenAI 原生 web_search 已关闭，但保存配置失败：${error}`
						: "OpenAI 原生 web_search 已关闭，并已保存到 ~/.pi/web-search.json",
					error ? "warning" : "info",
				);
				return;
			}

			if (!action || action === "status") {
				ctx.ui.notify(
					`OpenAI 原生 web_search 当前为 ${enabled ? "开启" : "关闭"}（持久化配置）`,
					"info",
				);
				return;
			}

			ctx.ui.notify("用法：/web-search on|off|status", "warning");
		},
	});

	// Restore the persisted setting for every new session and /reload.
	pi.on("session_start", (_event, ctx) => {
		enabled = readPersistentEnabled();
		updateStatus(ctx);
	});

	// Make the routing boundary explicit to the model. Without this, prompts
	// containing phrases such as "OpenAI Responses API" can make the model
	// misuse bash/Python to call api.openai.com instead of using the hosted
	// `web_search` tool that this extension injects below.
	pi.on("before_agent_start", (event, ctx) => {
		if (!enabled || !isTargetModel(ctx)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${NATIVE_WEB_SEARCH_GUIDANCE}`,
		};
	});

	// Pi builds its normal Responses API payload first. Append the hosted search
	// tool here so existing Pi tools (read/bash/edit/write) remain intact.
	pi.on("before_provider_request", (event, ctx) => {
		if (!enabled || !isTargetModel(ctx)) return;
		if (!event.payload || typeof event.payload !== "object") return;

		const payload = event.payload as Record<string, unknown>;
		const existingTools = payload.tools;
		if (existingTools !== undefined && !Array.isArray(existingTools)) return;
		const tools = Array.isArray(existingTools) ? existingTools : [];

		// Avoid adding a duplicate if another extension or model samplingParams
		// already supplied either current or preview web search.
		if (tools.some((tool) => {
			const type = toolType(tool);
			return type === "web_search" || type === "web_search_preview" || type?.startsWith("web_search_");
		})) {
			return;
		}

		return {
			...payload,
			tools: [...tools, WEB_SEARCH_TOOL],
		};
	});
}
