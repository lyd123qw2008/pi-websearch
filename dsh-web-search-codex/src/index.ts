/** Register the OpenAI Responses native web-search provider in `ctx.web`. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  CODEX_LOCAL_DEFAULT_MAX_OUTPUT_TOKENS,
  CODEX_LOCAL_DEFAULT_SEARCH_CONTEXT_SIZE,
  CodexLocalSearchProvider,
} from './provider.js'
import type { CodexLocalSearchProviderOptions } from './provider.js'
import type { ResponsesSearchContextSize } from './types.js'

export {
  buildSearchInput,
  CODEX_LOCAL_DEFAULT_MAX_OUTPUT_TOKENS,
  CODEX_LOCAL_DEFAULT_SEARCH_CONTEXT_SIZE,
  CODEX_LOCAL_PROVIDER_ID,
  CodexLocalSearchProvider,
  responsesEndpoint,
} from './provider.js'
export type { CodexLocalSearchProviderOptions } from './provider.js'
export { createResponsesSseParser, consumeResponsesSseResponse } from './responses-sse.js'
export { extractResponsesSources, extractResponsesText } from './extract.js'
export type {
  CodexSearchLlmRequest,
  ResponsesSearchContextSize,
  ResponsesSearchResponse,
} from './types.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'web-search-codex'

/** The Web capability seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY'
const BASE_URL_ENV = 'CODEX_LOCAL_BASE_URL'
const MODEL_ENV = 'CODEX_LOCAL_MODEL'

/**
 * Settings namespace carrying the endpoint, model, and native search options.
 *
 * On DSH 0.1.7 a settings namespace IS the profile entry id: `ctx.settings`
 * surfaces one form per composition entry whose Config declares volatile fields,
 * and there is no separate registration call. This constant therefore names the
 * entry that owns these fields rather than a scope the package registers.
 */
export const WEB_SEARCH_CODEX_SETTINGS_NAMESPACE = 'web-search-codex'

/**
 * Plugin configuration. Missing endpoint or model values make the provider
 * unavailable.
 *
 * Every field is `Volatile`: a volatile Config field is what makes the entry
 * editable from the DSH settings surface, and reading it through `get()` at each
 * use is what lets a stored override reach the next search without re-registering
 * the provider. A field that is not volatile makes the whole entry invisible to
 * `ctx.settings`, which also means no stored section can ever be imported for it.
 */
export interface Config {
  /** Literal bearer credential; prefer {@link apiKeyEnv}. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each search. */
  apiKeyEnv: Volatile<string>
  /** Responses base URL or complete `/responses` endpoint. */
  baseURL: Volatile<string | undefined>
  /** Responses model id. */
  model: Volatile<string | undefined>
  /** Native Responses web-search context size. */
  searchContextSize: Volatile<ResponsesSearchContextSize>
  /** Consume the endpoint's SSE stream. Defaults to true. */
  stream: Volatile<boolean>
  /** Optional generated-output token cap. */
  maxOutputTokens: Volatile<number>
}

/**
 * Schema for {@link Config}. Deliberately un-annotated: a volatile field's parsed
 * output type is a `Volatile` reference rather than the field's data type, so an
 * explicit `z<Config>` return annotation does not hold. `apply` keeps the
 * interface as its parameter type.
 */
export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  baseURL: z.string().volatile(),
  model: z.string().volatile(),
  searchContextSize: z.union(['low', 'medium', 'high'] as const).default(CODEX_LOCAL_DEFAULT_SEARCH_CONTEXT_SIZE).volatile(),
  stream: z.boolean().default(true).volatile(),
  maxOutputTokens: z.number().step(1).min(1).default(CODEX_LOCAL_DEFAULT_MAX_OUTPUT_TOKENS).volatile(),
})

/**
 * Project the entry's current section into the options one search runs with.
 * Environment fallbacks stay here rather than in the provider: every value the
 * provider reads is already fully defaulted.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the section values read at this call.
 * @returns options for one search.
 */
function resolveOptions(
  ctx: Context,
  config: { [K in keyof Config]: ReturnType<Config[K]['get']> },
): CodexLocalSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = hasCredential(config.apiKey) ? config.apiKey : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(BASE_URL_ENV)?.value
      ?? '',
    model: config.model
      ?? launchEnvironmentOf(ctx).get(MODEL_ENV)?.value
      ?? '',
    searchContextSize: config.searchContextSize ?? CODEX_LOCAL_DEFAULT_SEARCH_CONTEXT_SIZE,
    stream: config.stream ?? true,
    maxOutputTokens: config.maxOutputTokens ?? CODEX_LOCAL_DEFAULT_MAX_OUTPUT_TOKENS,
    resolveOriginalRequest: () => latestUserRequest(ctx.get('agents')?.currentInitiator()),
  }
}

/**
 * Register the Codex-local Responses search provider.
 *
 * The entry's Config is the settings section: `apply` snapshots nothing, it
 * reads each volatile field through `get()` inside the options callback, so a
 * value saved from the settings surface is what the next search uses. DSH 0.1.7
 * removed the old `ctx.settings.register()` scope API, and a registration call
 * here would throw before the provider ever reached the registry.
 * @param ctx - context supplying Web, credentials, and session services.
 * @param config - the entry's volatile section.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new CodexLocalSearchProvider(() => resolveOptions(ctx, {
    apiKey: config.apiKey.get(),
    apiKeyEnv: config.apiKeyEnv.get(),
    baseURL: config.baseURL.get(),
    model: config.model.get(),
    searchContextSize: config.searchContextSize.get(),
    stream: config.stream.get(),
    maxOutputTokens: config.maxOutputTokens.get(),
  })))
}

function hasCredential(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function latestUserRequest(agent: Agent | undefined): string | undefined {
  if (agent === undefined) return undefined
  const session = agent.session as unknown as {
    snapshotEvents?: () => readonly SessionEventLike[]
    events?: readonly SessionEventLike[]
  }
  const events = session.snapshotEvents?.() ?? session.events ?? []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const text = textFromContent(event.data.content)
    if (text.trim().length > 0) return text
  }
  return undefined
}

type SessionEventLike = {
  type: string
  data: { content: readonly ContentBlock[] }
}

function textFromContent(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}
