# pi-websearch

Use the provider's native OpenAI Responses `web_search` tool in Pi, while rendering returned URL citations as ordinary Markdown links.

This project intentionally separates the two concerns:

```text
OpenAI Responses web_search
        ↓
URL annotations from the provider
        ↓
Markdown `### Sources` section
        ↓
Pi's existing Markdown/TUI hyperlink renderer
```

It does **not** run a second search engine. It does **not** use DuckDuckGo, `pi-web-access` search, or a custom function tool for the search itself.

## What is included

- `extensions/openai-web-search.ts`
  - `/web-search on`
  - `/web-search off`
  - `/web-search status`
  - default off for every session
  - only injects the hosted tool for `codex-local` + `openai-responses`
  - preserves Pi's existing tools
- `patches/pi-ai-openai-responses-citations.patch`
  - reads `url_citation` annotations from Responses output items
  - deduplicates source URLs
  - appends a Markdown `### Sources` list
  - removes raw `cite...` tokens if a gateway emits them as text
- `src/format-url-citations.mjs`
  - small, independently testable copy of the formatting logic

## Requirements

- Pi with an OpenAI Responses-compatible model/provider
- A backend that accepts:

  ```json
  { "type": "web_search" }
  ```

- The backend must preserve Responses URL annotations if clickable sources are required

The patch targets the generated `@earendil-works/pi-ai/dist/api/openai-responses-shared.js` file used by the installed Pi package. It is version-sensitive and should be reapplied after a Pi/pi-ai update.

## Install the extension

Copy the extension into the global Pi extension directory:

```text
C:/Users/<user>/.pi/agent/extensions/openai-web-search.ts
```

Or install this repository as a Pi package after publishing it:

```text
pi install git:github.com/<user>/pi-websearch
```

## Apply the pi-ai patch

Locate:

```text
@earendil-works/pi-ai/dist/api/openai-responses-shared.js
```

Back up the file, then apply:

```text
patches/pi-ai-openai-responses-citations.patch
```

A future version should replace the generated-file patch with a source-level patch or a maintained Pi package hook.

## Configure the model

The model must use:

```json
{
  "api": "openai-responses"
}
```

The extension currently targets provider `codex-local`. Adjust `TARGET_PROVIDER` in the extension if another provider should receive the native search tool.

## Use it

Restart Pi, then run:

```text
/web-search on
```

Test with:

```text
必须使用 OpenAI Responses 原生 web_search，不要抓取网页全文。搜索今天深圳天气，并列出 3 个来源。
```

Disable it again:

```text
/web-search off
```

Expected output:

```markdown
### Sources

- [Source title](<https://example.com>)
```

## Important limitations

- `store: false` and local Pi session handling are separate from citation rendering.
- If the proxy strips `url_citation` annotations, the Markdown source section cannot be reconstructed from the final text alone.
- The patch modifies an installed generated file and may be overwritten by package updates.
- Do not commit API keys, private proxy URLs, Pi sessions, model credentials, or backup files.

## Tests

```text
npm test
```

The test suite validates URL citation formatting, deduplication, Markdown escaping, and raw marker cleanup.
