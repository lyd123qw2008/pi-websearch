# @lyd123qw2008/dsh-web-search-codex

A standalone DeepSeek Harness `WebSearchProvider` that calls an OpenAI Responses-compatible endpoint with the native Responses `web_search` server tool.

This package lives in the personal [`pi-websearch`](https://github.com/lyd123qw2008/pi-websearch) project rather than the DeepSeek Harness source tree. It is independent from the Pi extension in the parent project and does not import Pi runtime APIs.

## Prerequisites

- A DeepSeek Harness Web Profile that mounts `@deepseek-ai/dsh-web` and `@deepseek-ai/dsh-tool-web`.
- A DSH runtime from the `0.1.0-rc.8` release line, which satisfies this package's peer dependencies.
- Node.js `22.19.0` or newer.
- An OpenAI Responses-compatible endpoint that accepts `POST /responses` and the native `web_search` server tool.
- An explicitly resolved bearer credential. The examples use the `OPENAI_API_KEY` credential reference; do not put the secret itself in `settings.yaml` or `cordis.patch.yml`.

The package does not read or refresh Codex `auth.json`. Configure an API key or another explicitly resolved bearer credential. The existing Codex app-server remains the subagent path for complex research and coding tasks; this package is the ordinary `ctx.web` search path.

## Install

### Published package

Install the package into the Web Profile's package directory. Replace `<DSH_HOME>` with the directory that contains your `profiles` and `settings.yaml` directories.

```text
corepack pnpm --dir <DSH_HOME>/profiles/web add @lyd123qw2008/dsh-web-search-codex@0.1.0
```

For example, on Windows:

```text
corepack pnpm --dir D:\path\to\deepseek-harness-data\profiles\web add @lyd123qw2008/dsh-web-search-codex@0.1.0
```

The published package expects the DSH runtime peer dependencies to be supplied by the Profile. It carries only Schemastery as a regular runtime dependency.

### Local development package

From this repository, install the package into the Profile with a local path. This `link:` belongs in the Profile's package manifest because it is the deliberate local development target; the published package manifest contains no path dependency on a Harness checkout.

```text
corepack pnpm --dir <DSH_HOME>/profiles/web add D:\path\to\pi-websearch\dsh-web-search-codex
```

Build the package before loading it from the Profile:

```text
corepack pnpm install
corepack pnpm run build
```

## Enable the provider

A raw provider package is inserted by the Profile patch; it is not a Bundle and does not belong in `dsh.profile.bundles`.

Copy [`config/cordis.patch.yml.example`](config/cordis.patch.yml.example) to the Web Profile's `cordis.patch.yml`, or add the equivalent entries to that file:

```yaml
- id: web
  config:
    searchProvider: codex-local
- insert:
    - id: web-search-codex
      name: '@lyd123qw2008/dsh-web-search-codex'
```

The `web` row selects this provider instead of the built-in `deepseek-official` provider. The `dsh-tool-web` model-facing `web_search` tool does not change, and no Agent preset change is required for sessions that call that tool.

## Configure `settings.yaml`

Put deployment-specific values in the DSH home settings file:

```yaml
# <DSH_HOME>/settings.yaml
web-search-codex:
  apiKeyEnv: OPENAI_API_KEY
  baseURL: https://your-responses-gateway.example/v1
  model: your-model
  searchContextSize: medium
  stream: true
  maxOutputTokens: 4096
```

Configure the referenced credential through the DSH credential/environment mechanism. For an environment-backed credential, make `OPENAI_API_KEY` available to the DSH launch environment. Do not write the bearer value into this YAML file.

The configuration section is projected for the next search, so endpoint/model changes and credential rotation do not require provider re-registration or a process restart. The provider becomes unavailable when the endpoint or model is missing.

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal bearer credential, marked as a Settings secret. Prefer `apiKeyEnv`. |
| `apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved for each search. |
| `baseURL` | `$CODEX_LOCAL_BASE_URL` | Responses base URL or complete `/responses` endpoint. A missing value makes the provider unavailable. |
| `model` | `$CODEX_LOCAL_MODEL` | Responses model id. A missing value makes the provider unavailable. |
| `searchContextSize` | `medium` | Native search context: `low`, `medium`, or `high`. |
| `stream` | `true` | Read Responses SSE instead of one JSON response. |
| `maxOutputTokens` | `4096` | Positive generated-output cap. |

## Use it

Start or reload the Web Profile after installing and configuring the package:

```text
dsh --profile web
```

Then send an ordinary search request in the DSH Web UI, for example:

```text
查询 OpenAI 最近的 3 条官方新闻。每条事实后面保留网页标题和完整 URL。
```

The request path is:

```text
Agent
  → dsh-tool-web: web_search
  → ctx.web: searchProvider = codex-local
  → POST /responses with native web_search
  → nested Responses result
  → parent model's final answer
```

The provider also receives the latest non-empty user request when an initiating Agent session exists. This lets the nested Responses model follow language, count, scope, title, URL, and output-format requirements instead of receiving only a shortened search query.

A child Agent that calls DSH's `web_search` tool uses the same `ctx.web` provider selection. A child that directly invokes the Codex app-server's own native web search is a separate path and is not intercepted by this provider.

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
corepack pnpm pack --dry-run
```

The tests cover nested input construction, raw text and URL-citation projection, SSE chunk boundaries, native request fields, missing credentials, cancellation, redirect policy, Settings hot updates, secret redaction, Loader namespace composition, and provider disposal.

## Known Limitations and Deferred Work

- **Explicit bearer credentials only** — the package does not read or refresh Codex `auth.json`; a future OAuth integration needs a dedicated credential provider.
- **No GUI progress channel** — SSE is parsed for cancellation and response assembly, but the current DSH `WebSearchProvider` API has no operation-progress callback.
- **Auxiliary model latency remains** — direct Responses transport avoids app-server startup, but retrieval and nested generation still take time.
- **Structured citations are optional** — an endpoint that returns text without `url_citation` annotations produces an answer with an empty `sources[]`; URLs are not scraped from prose.
