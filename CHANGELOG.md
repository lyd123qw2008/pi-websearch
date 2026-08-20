# Changelog

## 0.2.1 - 2026-08-19

- Publish the npm package as `@lyd123qw2008/pi-websearch` because the unscoped
  name conflicts with an existing npm package.
- Document scoped npm and Pi installation.

## 0.2.0 - 2026-08-19

- Publish the simplified B-minimal host-side search architecture.
- Return nested `codex-local` Responses search text to the parent Pi model.
- Remove plugin-owned citation formatting and custom final-answer rendering.
- Publish as a public Pi package and npm package.

## Unreleased

## 0.2.2 - 2026-08-19

- Add configurable nested Responses SSE streaming with `nativeWebSearch.stream`.
- Make nested Responses SSE streaming the default while keeping buffered JSON as an opt-out.
- Surface native web-search progress through Pi tool execution updates when streaming is enabled.
- Add `renderCall()` query display, `/web-search stream on|off|status` controls, and a configurable footer status display selector.
- Simplify the package to a thin host-side `web_search` adapter.
- Return the nested `codex-local` Responses search text directly to the parent Pi
  model instead of formatting citations inside the plugin.
- Remove plugin-owned numbered citation generation, `Sources:` generation,
  source fallback formatting, custom TUI entries, and terminating tool results.
- Remove the public `format numbered` design from the stable product direction.
- Keep the original user request in the nested search input so count, language,
  scope, and requested output format are preserved.
- Keep only the minimal Responses text extraction fallback for providers that do
  not populate `response.output_text`.
- Remove the generated `pi-ai` citation patch from the formal package flow.

## 0.1.0

- Add session-local `/web-search on|off|status` extension.
- Use native OpenAI Responses `web_search` only for `codex-local` /
  `openai-responses`.
- Persist the native search enabled state in `~/.pi/web-search.json`.
