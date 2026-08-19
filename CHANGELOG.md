# Changelog

## Unreleased

- Render Responses URL annotations as inline clickable `[n]` markers.
- Add a deduplicated `Sources:` index with title and domain labels.
- Reuse source numbers for repeated citations and preserve source-only fallback.
- Add tests for same-position citations, repeated sources, CJK text, and missing indexes.
- Add routing guidance to prevent direct API-key or shell-based web-search fallbacks.
- Preserve visible square brackets around inline citation numbers in Pi's Markdown renderer.
- Document the difference between raw `-p --mode text` Markdown and rendered TUI output.

## 0.1.0

- Add session-local `/web-search on|off|status` extension.
- Inject native OpenAI Responses `web_search` only for `codex-local` / `openai-responses`.
- Convert Responses URL annotations into Markdown `### Sources` links.
- Remove raw platform citation tokens from finalized assistant text.
- Add citation formatting tests and installation notes.
