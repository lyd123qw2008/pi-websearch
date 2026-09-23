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

### `@lyd123qw2008/dsh-web-search-codex` 0.1.3 — 2026-09-23

- Move the package onto the DSH 0.1.7 settings API. Every `Config` field is now
  `volatile()`, which is what makes the composition entry itself a settings
  namespace.
- Remove the `ctx.settings.register()` call. DSH 0.1.7 replaced the registered
  scope API with one form per profile entry and no longer exposes `register()`,
  so the call threw on load and a stored section could never be applied.
- Read the section through the volatile references on each search instead of a
  cached settings scope.
- Drop the `@deepseek-ai/dsh-settings` dependency and raise the DSH peer range to
  `^0.1.7-alpha.1` (`^4.0.3` for `@deepseek-ai/cordis`). `0.1.2` remains the last
  release for the `0.1.0-rc.x` line.
- Point the example Profile patch at the inline entry `config:` block. DSH 0.1.7
  no longer reads a `<DSH_HOME>/settings.yaml` section for this package.
- Fixes `configured web provider "codex-local" is registered but unavailable`:
  with no surviving endpoint or model the provider's `available()` was false, and
  a pinned `web.config.searchProvider` does not fall back to another provider.

### 0.1.1 / 0.1.2

- Add the standalone `@lyd123qw2008/dsh-web-search-codex` package under `dsh-web-search-codex/`.
- Register `codex-local` on DSH `ctx.web` through the native Responses `web_search` server tool.
- Fix the standalone DSH provider so it does not write an unknown provider-specific event into DSH durable Session logs.
- Make `dsh-web-search-codex` read the DSH Session snapshot API while retaining the legacy event-array fallback.

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
