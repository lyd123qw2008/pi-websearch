# pi-websearch

A standalone Pi package that registers a small host-side `web_search` tool.
The tool calls the configured `codex-local` OpenAI Responses endpoint with the
native Responses `web_search` tool, then returns the nested search result to the
parent Pi model.

The parent model decides the final answer format from the user's prompt. The
plugin does not impose `[1]` citations, a `Sources:` section, a fixed list
layout, or a title/URL template.

## Architecture

```text
Pi Agent / parent model
   ↓
pi-websearch web_search tool
   ↓
codex-local Responses endpoint
   ↓
Native Responses web_search
   ↓
Nested Codex output_text
   ↓
Tool result returned to the parent model
   ↓
Parent model writes the final answer
```

This is intentionally a thin adapter. It does not reimplement Codex citation
formatting or final-answer rendering.

## DSH adapter

The same project contains a separate DSH package at [`dsh-web-search-codex/`](dsh-web-search-codex/). It registers `codex-local` as a `WebSearchProvider` on `ctx.web` and keeps `dsh-tool-web` as the model-facing tool owner. The DSH package has its own manifest, build, tests, and public DSH version dependencies; it does not depend on this Pi extension or on a neighboring Harness checkout.

Use the DSH package README for Profile installation and configuration. The Profile may use a local `link:` spec while developing this personal package, but the package manifest itself contains no local path dependency.

## Responsibilities

### Plugin

- Register `web_search`.
- Reuse the active `codex-local` model's endpoint and authentication.
- Send the original user request together with the search query.
- Use native Responses `web_search`.
- Extract `response.output_text` or message `output_text` content.
- Return that text unchanged as the tool result.
- Report request failures or empty results.
- Provide `/web-search on`, `/web-search off`, `/web-search stream`, `/web-search display`, and `/web-search status`.

### Parent model

- Decide whether a search is needed.
- Decide the language and level of detail.
- Decide whether to use paragraphs, lists, tables, Markdown links, title/URL
  lines, `[1]` citations, or `Sources:`.
- Produce the final answer for the user.

## What the plugin does not do

The plugin deliberately does not:

- insert or renumber `[1]`, `[2]`, etc.;
- generate a `Sources:` section;
- parse or reposition citation spans;
- rewrite Markdown links;
- deduplicate or relabel visible sources;
- append a synthetic source fallback;
- clean or transform the nested result text;
- render a separate TUI-only final entry;
- terminate the parent model's turn;
- provide `/web-search format numbered`;
- patch `pi-ai`, `pi-tui`, `pi-coding-agent`, or `node_modules`.

The nested result is intentionally passed through unchanged so the parent model
can use it as research context and follow the user's original instructions.

## Install

For the current local development package:

```text
pi install npm:@lyd123qw2008/pi-websearch@0.2.2
```

The package is enabled through Pi's settings package list. It does not require
copying an extension into `~/.pi/agent/extensions/`.

## Configuration

The persistent settings control whether the plugin-owned search tool is enabled
and whether the nested Responses request uses SSE streaming. Streaming defaults
to `true` when omitted:

```json
{
  "nativeWebSearch": {
    "enabled": true,
    "stream": true,
    "statusDisplay": "switch"
  }
}
```

`statusDisplay` defaults to `switch`, which keeps the persistent footer short:
`web-search: on`. Other choices are `mode`, `verbose`, and `hidden`.

Inside interactive Pi:

```text
/web-search on
/web-search off
/web-search stream on
/web-search stream off
/web-search stream status
/web-search display
/web-search display switch|mode|verbose|hidden
/web-search status
```

With `stream: true`, the plugin parses nested Responses SSE events and sends
search progress through Pi's tool `onUpdate` callback. The final nested result
is still returned unchanged to the parent model. With `stream: false`, the
plugin waits for one complete JSON Responses payload.

The package expects the active model to be:

```text
provider: codex-local
api: openai-responses
```

The base URL and authentication are taken from Pi's normal model configuration.
No API key, proxy URL, session, or model credential is stored in this package.

## Nested request

The plugin sends a small instruction block with the original request and the
search query:

```text
Use the native web search tool to answer the original user's request.
Return only the search result for the parent model.
Follow the original user's language, scope, count, and requested output format.
Preserve exact page titles and complete URLs when the user asks for them or when they are useful.
Do not mention this nested search call or add planning commentary.
Do not invent sources or URLs.
```

There is no fixed citation or output template.

## Runtime behavior

The tool uses a normal Pi tool result and does not use `terminate: true`:

```text
user request
  ↓
web_search tool execution
  ↓
(optional) nested Responses SSE progress updates
  ↓
search result tool message
  ↓
parent model response
  ↓
normal Pi rendering
```

The persistent footer shows only `web-search: on` by default. Use
`/web-search display` to open a selector for the short switch-only view, the
switch-plus-mode view, a verbose implementation view, or no footer status.
`/web-search status` always shows the detailed configuration regardless of the
selected footer display. The tool call renderer shows the actual `query`. When
nested streaming is enabled, Pi can also show progress such as
`正在搜索网页：...`; those updates are UI/tool-execution updates, not additional
user messages.

TUI, text, JSON, and RPC modes therefore share the same basic behavior.

## Security and boundaries

- Only `codex-local` with `openai-responses` is targeted.
- Authentication is resolved through Pi's public `ModelRegistry` API.
- Native Responses `web_search` is used inside the nested request.
- The plugin does not use bash, Python, curl, browser tools, DuckDuckGo, or
  external search APIs as a fallback.
- The plugin does not modify Pi installation files or generated dependencies.
- If the nested request fails, the tool reports the failure instead of inventing
  a result.

## Tests

```text
npm test
node --check src/extract-responses-text.mjs
git diff --check
```

Tests cover the minimal response-text extraction and SSE paths:

- canonical `response.output_text`;
- message-content fallback;
- ignoring search-call and reasoning items;
- empty responses;
- SSE chunk boundaries and CRLF;
- multiline SSE data and the Responses `[DONE]` sentinel.
