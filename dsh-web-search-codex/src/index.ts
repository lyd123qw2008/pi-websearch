/** Register the OpenAI Responses native web-search provider in `ctx.web`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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

/** Settings namespace carrying the endpoint, model, and native search options. */
export const WEB_SEARCH_CODEX_SETTINGS_NAMESPACE = settingsNamespace('web-search-codex')

/** Plugin configuration. Missing endpoint or model values make the provider unavailable. */
export interface Config {
  /** Literal bearer credential; prefer {@link apiKeyEnv}. */
  apiKey?: string
  /** Credential reference resolved for each search. */
  apiKeyEnv?: string
  /** Responses base URL or complete `/responses` endpoint. */
  baseURL?: string
  /** Responses model id. */
  model?: string
  /** Native Responses web-search context size. */
  searchContextSize?: ResponsesSearchContextSize
  /** Consume the endpoint's SSE stream. Defaults to true. */
  stream?: boolean
  /** Optional generated-output token cap. */
  maxOutputTokens?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string(),
  searchContextSize: z.union(['low', 'medium', 'high'] as const).default(CODEX_LOCAL_DEFAULT_SEARCH_CONTEXT_SIZE),
  stream: z.boolean().default(true),
  maxOutputTokens: z.number().step(1).min(1).default(CODEX_LOCAL_DEFAULT_MAX_OUTPUT_TOKENS),
})

function resolveOptions(ctx: Context, config: Config): CodexLocalSearchProviderOptions {
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
    recordRequest: request => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/codex-search-llm-request',
        request,
      )
    },
  }
}

/**
 * Register the Codex-local Responses search provider.
 * @param ctx - context supplying Web, credentials, settings, and session services.
 * @param config - initial settings section projected for each later search.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_CODEX_SETTINGS_NAMESPACE, Config, config, {
    setSource: source => { current = source },
    onChange: () => {
      // Registration carries no resolved values; the provider projects the section per search.
    },
  })
  ctx.web.registerSearchProvider(new CodexLocalSearchProvider(() => resolveOptions(ctx, current())))
}

function hasCredential(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function latestUserRequest(agent: Agent | undefined): string | undefined {
  if (agent === undefined) return undefined
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index]
    if (event?.type !== 'user/message') continue
    const text = textFromContent(event.data.content)
    if (text.trim().length > 0) return text
  }
  return undefined
}

function textFromContent(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}
