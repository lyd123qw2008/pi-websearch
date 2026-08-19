# pi-websearch

Use the provider's native OpenAI Responses `web_search` tool in Pi, while
rendering returned URL citations as compact clickable domain links next to the claims they support.

This follows Codex CLI's simple terminal behavior:

```text
OpenAI Responses web_search
        ↓
URL annotations from the provider
        ↓
Inline clickable domain link
        ↓
Pi's existing Markdown/TUI OSC-8 hyperlink renderer
```

It does **not** run a second search engine. It does **not** use DuckDuckGo, `pi-web-access` search, or a custom function tool for the search itself.

## What is included

- `extensions/openai-web-search.ts`
  - `/web-search on`
  - `/web-search off`
  - `/web-search status`
  - reads persistent state from `~/.pi/web-search.json` at startup
  - `/web-search on|off` updates `nativeWebSearch.enabled` for future sessions
  - only injects the hosted tool for `codex-local` + `openai-responses`
  - adds a routing instruction so the model uses `web_search` directly instead of calling external APIs through bash/Python
  - preserves Pi's existing tools
- `patches/pi-ai-openai-responses-citations.patch`
  - reads `url_citation` annotations from Responses output items
  - places `([domain](<URL>))` next to the supported claim
  - lets the TUI show only the domain while keeping the full URL as the link target
  - avoids duplicating URLs already emitted by the model
  - falls back to standalone domain links when span positions are unavailable
  - removes raw `cite...` tokens if a gateway emits them as text
- `src/format-url-citations.mjs`
  - small, independently testable copy of the rendering logic

## Requirements

- Pi with an OpenAI Responses-compatible model/provider
- A backend that accepts:

  ```json
  { "type": "web_search" }
  ```

- The backend must preserve Responses URL annotations if source placement is required

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

The extension reads this setting at startup:

```json
{
  "nativeWebSearch": {
    "enabled": true
  }
}
```

You can change and persist it from Pi:

```text
/web-search on
/web-search off
/web-search status
```

Test with:

```text
必须使用 OpenAI Responses 原生 web_search，不要抓取网页全文。搜索今天深圳天气，并列出 3 个来源。
```

After `/web-search on` or `/web-search off`, the selected state is restored by the next new session or `/reload`.

Expected terminal output:

```text
The answer is supported by the official documentation. (example.com)
```

`example.com` is the visible OSC-8 link text; the full URL remains its
clickable destination. In raw `-p --mode text` Markdown, the same output is
represented as `([example.com](<https://example.com>))`. If the provider does
not return annotation positions, the patch keeps the answer intact and
appends standalone domain links as a fallback. URLs already present in the
model's answer are not duplicated.

## Important limitations

- `store: false` and local Pi session handling are separate from citation rendering.
- The model may still refuse a prompt that explicitly asks it to call the OpenAI API itself; ask for the information normally (for example, `查询微软新闻`) and let the extension route it to `web_search`.
- If the proxy strips `url_citation` annotations, the formatter cannot place a domain link beside the supported claim; URLs already emitted by the model remain untouched.
- The patch modifies an installed generated file and may be overwritten by package updates.
- Do not commit API keys, private proxy URLs, Pi sessions, model credentials, or backup files.

## Tests

```text
npm test
```

The test suite validates inline source placement, duplicate-URL suppression,
source-only fallback, same-position ordering, CJK text, Markdown escaping, and
raw marker cleanup.
