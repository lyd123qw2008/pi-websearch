import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TARGET_PROVIDER = "codex-local";
const TARGET_API = "openai-responses";

// OpenAI Responses API hosted web search tool. It is deliberately not added to
// models.json so web search remains off unless the user enables it for a turn.
const WEB_SEARCH_TOOL = {
	type: "web_search",
	search_context_size: "medium",
};

let enabled = false;

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
		description: "开关 codex-local 的 OpenAI Responses web_search：on、off 或 status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "on") {
				enabled = true;
				updateStatus(ctx);
				ctx.ui.notify(
					"OpenAI 原生 web_search 已开启（仅对 codex-local / openai-responses 生效）",
					"info",
				);
				return;
			}

			if (action === "off") {
				enabled = false;
				updateStatus(ctx);
				ctx.ui.notify("OpenAI 原生 web_search 已关闭", "info");
				return;
			}

			if (!action || action === "status") {
				ctx.ui.notify(`OpenAI 原生 web_search 当前为 ${enabled ? "开启" : "关闭"}`, "info");
				return;
			}

			ctx.ui.notify("用法：/web-search on|off|status", "warning");
		},
	});

	// Search is intentionally session-local and defaults to off after startup or /reload.
	pi.on("session_start", (_event, ctx) => {
		enabled = false;
		updateStatus(ctx);
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
