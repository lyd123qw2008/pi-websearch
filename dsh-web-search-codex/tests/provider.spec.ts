import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  buildSearchInput,
  CODEX_LOCAL_PROVIDER_ID,
  CodexLocalSearchProvider,
} from '../src/provider.js'
import { createResponsesSseParser } from '../src/responses-sse.js'
import { extractResponsesSources, extractResponsesText } from '../src/extract.js'
import type { CodexLocalSearchProviderOptions } from '../src/provider.js'

function provider(overrides: Partial<CodexLocalSearchProviderOptions> = {}): CodexLocalSearchProvider {
  return new CodexLocalSearchProvider(() => ({
    apiKey: 'access-token',
    baseURL: 'https://codex.test/v1',
    model: 'gpt-search',
    searchContextSize: 'medium',
    stream: false,
    maxOutputTokens: 512,
    ...overrides,
  }))
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('buildSearchInput', () => {
  it('keeps the original request and query in nested instructions', () => {
    expect(buildSearchInput('latest news', 'Answer in Chinese with three URLs')).toContain(
      'Original user request:\nAnswer in Chinese with three URLs\n\nSearch query:\nlatest news',
    )
  })

  it('omits the original request for agentless calls', () => {
    const input = buildSearchInput('latest news')
    expect(input).toContain('Search query:\nlatest news')
    expect(input).not.toContain('Original user request:')
  })
})

describe('Responses projections', () => {
  it('prefers top-level output text without rewriting it', () => {
    const text = 'raw citation marker and https://example.test'
    expect(extractResponsesText({ output_text: text })).toBe(text)
  })

  it('falls back to message content and maps structured URL citations once', () => {
    const response = {
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'answer',
          annotations: [
            { type: 'url_citation', url: 'https://a.test', title: 'A' },
            { type: 'url_citation', url: 'https://a.test', title: 'duplicate' },
            { type: 'url_citation', url: 'https://b.test' },
          ],
        }],
      }],
    }
    expect(extractResponsesText(response)).toBe('answer')
    expect(extractResponsesSources(response)).toEqual([
      { url: 'https://a.test', title: 'A' },
      { url: 'https://b.test' },
    ])
  })
})

describe('CodexLocalSearchProvider', () => {
  it('posts native web_search and returns text plus structured sources', async () => {
    let request: { url: string; init: RequestInit } | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: String(input), init: init ?? {} }
      return jsonResponse({
        output_text: 'Keep this text exactly.',
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            annotations: [{ type: 'url_citation', url: 'https://a.test', title: 'A' }],
          }],
        }],
      })
    }))
    const recordRequest = vi.fn()
    const result = await provider({
      recordRequest,
      resolveOriginalRequest: () => 'Use Chinese and preserve URLs.',
    }).search({ query: 'latest news', maxResults: 8 })

    expect(result).toEqual({
      content: 'Keep this text exactly.',
      sources: [{ url: 'https://a.test', title: 'A' }],
      truncated: false,
    })
    expect(request?.url).toBe('https://codex.test/v1/responses')
    expect(request?.init.redirect).toBe('error')
    expect((request?.init.headers as Record<string, string>).authorization).toBe('Bearer access-token')
    expect(JSON.parse(String(request?.init.body))).toEqual({
      model: 'gpt-search',
      input: expect.stringContaining('Original user request:'),
      tools: [{ type: 'web_search', search_context_size: 'medium' }],
      stream: false,
      store: false,
      max_output_tokens: 512,
    })
    expect(recordRequest).toHaveBeenCalledOnce()
    expect(recordRequest.mock.calls[0]?.[0].body).toMatchObject({ model: 'gpt-search', stream: false, store: false })
  })

  it('consumes streamed Responses events across chunk boundaries', async () => {
    const chunks = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel',
      'lo"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Hello","annotations":[{"type":"url_citation","url":"https://a.test"}]}]}]}}\n\n',
      'data: [DONE]\n\n',
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })))

    await expect(provider({ stream: true }).search({ query: 'stream' })).resolves.toEqual({
      content: 'Hello',
      sources: [{ url: 'https://a.test' }],
      truncated: false,
    })
  })

  it('returns a structured missing-credential error', async () => {
    const error = await provider({
      apiKey: undefined,
      resolveApiKey: async () => undefined,
      apiKeyEnv: credentialRef('CODEX_API_KEY'),
    }).search({ query: 'missing key' }).catch(value => value)
    expect(error).toBeInstanceOf(WebError)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('surfaces caller cancellation before dispatch', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort('stop')

    await expect(provider().search({ query: 'cancelled' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps HTTP errors and rejects redirects in the request policy', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(
      JSON.stringify({ error: { message: 'bad request' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetch)
    await expect(provider().search({ query: 'bad' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'bad request',
    })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })

  it('reports stable id and cheap availability', () => {
    expect(provider().id).toBe(CODEX_LOCAL_PROVIDER_ID)
    expect(provider().available()).toBe(true)
    expect(provider({ baseURL: 'not a URL' }).available()).toBe(false)
    expect(provider({ apiKey: '  ' }).available()).toBe(false)
  })
})

describe('createResponsesSseParser', () => {
  it('handles comments, CRLF, multiline data, and DONE', () => {
    const events: { event: string; data: unknown }[] = []
    const parser = createResponsesSseParser(event => events.push(event))
    parser.push(': keepalive\r\nevent: test\r\ndata: {"a":\r\n')
    parser.push('data:1}\r\n\r\ndata: [DONE]\r\n\r\n')
    parser.end()
    expect(events).toEqual([
      { event: 'test', data: { a: 1 } },
      { event: 'message', data: '[DONE]' },
    ])
  })
})
