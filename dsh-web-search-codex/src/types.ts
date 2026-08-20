import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/** A JSON object crossing the Responses HTTP boundary. */
export type JsonObject = Record<string, unknown>

/** A URL citation attached to an output text part. */
export interface ResponsesUrlCitation {
  readonly type?: string
  readonly url?: string
  readonly title?: string
}

/** One Responses message content part. */
export interface ResponsesContentPart {
  readonly type?: string
  readonly text?: string
  readonly annotations?: readonly ResponsesUrlCitation[]
}

/** One Responses output item. */
export interface ResponsesOutputItem {
  readonly type?: string
  readonly output_text?: string
  readonly content?: readonly ResponsesContentPart[]
}

/** Responses response envelope fields consumed by the provider. */
export interface ResponsesSearchResponse {
  readonly output_text?: string
  readonly output?: readonly ResponsesOutputItem[]
  readonly error?: JsonObject
}

/** Search context-size values accepted by the OpenAI Responses server tool. */
export type ResponsesSearchContextSize = 'low' | 'medium' | 'high'

/** Secret-free Responses request envelope used for request projection and tests. */
export interface CodexSearchLlmRequest {
  /** Fully resolved Responses endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to the provider. */
  readonly body: {
    readonly model: string
    readonly input: string
    readonly tools: readonly [{
      readonly type: 'web_search'
      readonly search_context_size: ResponsesSearchContextSize
    }]
    readonly stream: boolean
    readonly store: false
    readonly max_output_tokens?: number
  }
}

/** Structured source projection used by tests and consumers. */
export type { WebSearchSource }
