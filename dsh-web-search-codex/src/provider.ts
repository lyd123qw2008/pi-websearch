/** OpenAI Responses native web-search provider for DSH. */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  CodexSearchLlmRequest,
  JsonObject,
  ResponsesSearchContextSize,
  ResponsesSearchResponse,
} from './types.js'
import { consumeResponsesSseResponse } from './responses-sse.js'
import { extractResponsesSources, extractResponsesText, withStreamedText } from './extract.js'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary Responses request recorded before dispatch. */
    'web/codex-search-llm-request': CodexSearchLlmRequest
  }
}

/** Stable provider id for an OpenAI Responses-compatible endpoint. */
export const CODEX_LOCAL_PROVIDER_ID = 'codex-local'

/** Default native Responses web-search context size. */
export const CODEX_LOCAL_DEFAULT_SEARCH_CONTEXT_SIZE: ResponsesSearchContextSize = 'medium'

/** Default generated-output token cap. */
export const CODEX_LOCAL_DEFAULT_MAX_OUTPUT_TOKENS = 4096

const USER_AGENT = 'dsh-web-search-codex/0.1.0'

/** Resolved options for one Codex-local Responses search operation. */
export interface CodexLocalSearchProviderOptions {
  /** Literal bearer credential; prefer {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the current bearer credential for one search. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference used in missing-credential diagnostics. */
  readonly apiKeyEnv?: CredentialRef
  /** Responses base URL or complete `/responses` endpoint. */
  readonly baseURL: string
  /** Responses model id. */
  readonly model: string
  /** Native web-search context size. */
  readonly searchContextSize: ResponsesSearchContextSize
  /** Whether to consume the Responses SSE stream. */
  readonly stream: boolean
  /** Optional generated-output token cap. */
  readonly maxOutputTokens?: number
  /** Resolve the latest user request when an initiating Agent exists. */
  readonly resolveOriginalRequest?: () => string | undefined
  /** Record the exact secret-free request immediately before dispatch. */
  readonly recordRequest?: (request: CodexSearchLlmRequest) => void
}

/** OpenAI Responses native web-search provider registered on `ctx.web`. */
export class CodexLocalSearchProvider implements WebSearchProvider {
  readonly id = CODEX_LOCAL_PROVIDER_ID

  /**
   * @param resolveOptions - options snapshotted at the start of each operation.
   */
  constructor(private readonly resolveOptions: () => CodexLocalSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return (hasCredential(options.apiKey) || options.resolveApiKey !== undefined)
      && URL.canParse(options.baseURL)
      && options.model.trim().length > 0
      && isContextSize(options.searchContextSize)
      && (options.maxOutputTokens === undefined || isPositiveInteger(options.maxOutputTokens))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await resolveApiKey(options, signal)
    throwIfAborted(signal)
    const endpoint = responsesEndpoint(options.baseURL)
    const body: CodexSearchLlmRequest['body'] = {
      model: options.model,
      input: buildSearchInput(request.query, options.resolveOriginalRequest?.()),
      tools: [{ type: 'web_search', search_context_size: options.searchContextSize }],
      stream: options.stream,
      store: false,
      ...options.maxOutputTokens === undefined ? {} : { max_output_tokens: options.maxOutputTokens },
    }
    options.recordRequest?.({ endpoint, body })
    throwIfAborted(signal)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: options.stream ? 'text/event-stream' : 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Codex-local search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) throw await providerResponseError(response, signal)

    try {
      const payload = options.stream
        ? await readStreamingResponse(response, signal)
        : await readJsonResponse(response, signal)
      const text = extractResponsesText(payload)
      if (text.trim().length === 0) {
        throw new WebError('Codex-local Responses search returned no textual result', 'WEB_PROVIDER_ERROR')
      }
      return {
        content: text,
        sources: extractResponsesSources(payload),
        truncated: false,
      }
    } catch (error: unknown) {
      if (error instanceof WebError) throw error
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`Codex-local returned an unprocessable Responses payload: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** Build the nested search instruction sent to the Responses model. */
export function buildSearchInput(query: string, originalRequest?: string): string {
  return [
    originalRequest === undefined || originalRequest.trim().length === 0
      ? undefined
      : `Original user request:\n${originalRequest}`,
    `Search query:\n${query}`,
    [
      'Use the native web search tool to answer the original user request.',
      'Return only the search result for the parent model.',
      "Follow the user's language, scope, count, and requested output format.",
      'Preserve exact page titles and complete URLs when requested or useful.',
      'Do not mention this nested search call or add planning commentary.',
      'Do not invent sources or URLs.',
    ].join('\n'),
  ].filter((part): part is string => part !== undefined).join('\n\n')
}

/** Normalize a configured base URL to the Responses operation endpoint. */
export function responsesEndpoint(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/u, '')
  return normalized.endsWith('/responses') ? normalized : `${normalized}/responses`
}

async function resolveApiKey(options: CodexLocalSearchProviderOptions, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  if (hasCredential(options.apiKey)) return options.apiKey.trim()
  let resolved: string | undefined
  try {
    resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    throw new WebError(`Codex-local search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  const normalized = resolved?.trim()
  if (normalized !== undefined && normalized.length > 0) return normalized
  throw new WebError(
    `Codex-local search has no bearer credential for "${options.apiKeyEnv ?? 'OPENAI_API_KEY'}"`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}

async function readJsonResponse(response: Response, signal?: AbortSignal): Promise<ResponsesSearchResponse> {
  throwIfAborted(signal)
  return await response.json() as ResponsesSearchResponse
}

async function readStreamingResponse(response: Response, signal?: AbortSignal): Promise<ResponsesSearchResponse> {
  let completed: ResponsesSearchResponse | undefined
  let outputText = ''
  await consumeResponsesSseResponse(response, ({ event, data }) => {
    if (data === '[DONE]') return
    const object = asObject(data)
    const eventType = typeof object.type === 'string' ? object.type : event
    if (eventType === 'response.failed' || eventType === 'error') {
      throw new Error(responseErrorMessage(object))
    }
    if (eventType === 'response.output_text.delta' && typeof object.delta === 'string') {
      outputText += object.delta
    }
    if (eventType === 'response.output_text.done' && outputText.length === 0 && typeof object.text === 'string') {
      outputText = object.text
    }
    if (eventType === 'response.completed') {
      completed = asObject(object.response) as ResponsesSearchResponse
    }
  }, signal)
  const result = withStreamedText(completed ?? {}, outputText)
  if (completed === undefined && outputText.length === 0) {
    throw new Error('Responses streaming search ended without a completed response')
  }
  return result
}

async function providerResponseError(response: Response, signal?: AbortSignal): Promise<WebError> {
  let message = `Codex-local Responses API error (HTTP ${response.status})`
  try {
    const text = await response.text()
    if (text.trim().length > 0) {
      const parsed: unknown = JSON.parse(text)
      message = responseErrorMessage(asObject(parsed)) || message
    }
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) return searchAborted(signal, error)
  }
  return new WebError(message, 'WEB_PROVIDER_ERROR')
}

function responseErrorMessage(value: JsonObject): string {
  const error = asObject(value.error)
  return typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : typeof value.message === 'string' && value.message.length > 0
      ? value.message
      : 'Codex-local Responses request failed'
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function isContextSize(value: string): value is ResponsesSearchContextSize {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function hasCredential(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Codex-local search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(searchAborted(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}
