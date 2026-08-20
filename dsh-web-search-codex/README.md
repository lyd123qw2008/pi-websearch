# @lyd123qw2008/dsh-web-search-codex

A standalone DeepSeek Harness `WebSearchProvider` that calls an OpenAI Responses-compatible endpoint with the native Responses `web_search` server tool.

This package lives in the personal [`pi-websearch`](https://github.com/lyd123qw2008/pi-websearch) project rather than the DeepSeek Harness source tree. It is independent from the Pi extension in the parent project and does not import Pi runtime APIs.

## Behavior

- Registers `codex-local` on `ctx.web`.
- Keeps `dsh-tool-web` as the only model-facing `web_search` tool owner.
- Sends the latest non-empty user request, the search query, and a short nested-search instruction.
- Uses `POST /responses`, `web_search`, `store: false`, and configurable SSE streaming.
- Prefers `output_text` and otherwise reads message content text.
- Maps only structured `url_citation` annotations to normalized `sources[]`; it does not scrape URLs from prose or renumber citations.
- Rejects HTTP redirects before contacting the redirect target.
- Resolves credentials for each search through `ctx.credentials`, with an environment fallback when that service is absent.
- Records `web/codex-search-llm-request` with the endpoint and secret-free request body when an initiating Agent session exists.

The provider does not read or refresh Codex `auth.json`. Configure an API key or another explicitly resolved bearer credential. The existing Codex app-server remains the subagent path for complex research and coding tasks; this package is the ordinary `ctx.web` search path.

## Configuration

```yaml
- id: web
  config:
    searchProvider: codex-local
- insert:
    - id: web-search-codex
      name: '@lyd123qw2008/dsh-web-search-codex'
      config:
        apiKeyEnv: OPENAI_API_KEY
        baseURL: http://127.0.0.1:18085/v1
        model: gpt-5.6-luna
        searchContextSize: medium
        stream: true
        maxOutputTokens: 4096
```

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal bearer credential, marked as a Settings secret. Prefer `apiKeyEnv`. |
| `apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved for each search. |
| `baseURL` | `$CODEX_LOCAL_BASE_URL` | Responses base URL or complete `/responses` endpoint. |
| `model` | `$CODEX_LOCAL_MODEL` | Responses model id. A missing value makes the provider unavailable. |
| `searchContextSize` | `medium` | Native search context: `low`, `medium`, or `high`. |
| `stream` | `true` | Read Responses SSE instead of one JSON response. |
| `maxOutputTokens` | `4096` | Positive generated-output cap. |

The configuration section is projected for the next search, so endpoint/model changes and credential rotation do not require provider re-registration or a process restart.

## Install in a local DSH Profile

Build the package first:

```text
corepack pnpm install
corepack pnpm run build
```

For local profile development, add the package itself as a Profile dependency. This `link:` belongs in the Profile's package manifest because it is the deliberate local installation target; the published package manifest contains no path dependency on a Harness checkout.

```text
corepack pnpm --dir D:\liuyongdan\code\deepseek-harness-data\profiles\web add D:\liuyongdan\code\pi-websearch\dsh-web-search-codex
```

Then add a patch entry to the Profile's `cordis.patch.yml` as shown in the Configuration section. A raw provider package is inserted by the patch; it is not a Bundle and therefore does not belong in `dsh.profile.bundles`.

For a published install, replace the local package spec with the npm version and keep the same patch entry.

```text
corepack pnpm add @lyd123qw2008/dsh-web-search-codex@0.1.0
```

The published package expects the DSH runtime peers to be supplied by the Profile. The package itself carries only Schemastery as a regular runtime dependency.

## Model, token, and KV-cache effects

### Auxiliary Responses search request

#### What the model sees

A separate Responses model receives the original user request when available, one search query, and one native `web_search` server-tool definition. It is separate from the conversation model's context.

#### Token effect

Every search consumes input and output tokens on the configured Responses model. `maxOutputTokens` bounds generated output; native search context size controls the retrieval context sent to that model.

#### KV Cache effect

The auxiliary request has independent provider cache behavior. The fixed instruction prefix can remain reusable, while a changed user request, query, model, or endpoint changes the suffix from its first difference.

### Conversation tool result, indirectly

#### What the model sees

The conversation model receives the unchanged provider answer and the structured source list through `dsh-tool-web`. The consumer owns final rendering and citation instructions.

#### Token effect

Registration adds no conversation tokens. Each search result contributes its generated text and structured sources to the next conversation request.

#### KV Cache effect

The result enters the conversation as a normal tool result and follows the usual append-only history behavior.

## Tests and development

```text
corepack pnpm run check
corepack pnpm test
corepack pnpm run build
```

The tests cover nested input construction, raw text and URL-citation projection, SSE chunk boundaries, native request fields, missing credentials, cancellation, redirect policy, Settings hot updates, secret redaction, Loader namespace composition, and provider disposal.

## Known limitations and deferred work

- **Explicit bearer credentials only** — the package does not read or refresh Codex `auth.json`; a future OAuth integration needs a dedicated credential provider.
- **No GUI progress channel** — SSE is parsed for cancellation and response assembly, but the current DSH `WebSearchProvider` API has no operation-progress callback.
- **Auxiliary model latency remains** — direct Responses transport avoids app-server startup, but retrieval and nested generation still take time.
- **Structured citations are optional** — an endpoint that returns text without `url_citation` annotations produces an answer with an empty `sources[]`; URLs are not scraped from prose.
