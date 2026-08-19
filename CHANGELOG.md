# Changelog

## Unreleased

- Render Responses URL annotations as complete visible URLs beside supported claims.
- Keep full URLs as OSC-8 hyperlink destinations while preserving visibility in non-clickable terminals.
- Avoid duplicate URLs when the model already emitted a source link.
- Preserve standalone fallback URLs and add tests for source placement, repeated sources, CJK text, and missing indexes.
- Add routing guidance to prevent direct API-key or shell-based web-search fallbacks.
- Preserve visible complete URLs and OSC-8 hyperlink behavior in Pi's Markdown renderer.
- Prefer a parenthesized complete URL over a domain-only label so non-clickable terminals still expose the destination.
- Document the difference between raw `-p --mode text` Markdown and rendered TUI output.

## 0.1.0

- Add session-local `/web-search on|off|status` extension.
- Inject native OpenAI Responses `web_search` only for `codex-local` / `openai-responses`.
- Convert Responses URL annotations into Markdown `### Sources` links.
- Remove raw platform citation tokens from finalized assistant text.
- Add citation formatting tests and installation notes.
