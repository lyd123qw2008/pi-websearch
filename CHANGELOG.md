# Changelog

## Unreleased

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
