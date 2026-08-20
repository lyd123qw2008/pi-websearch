import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import type { ResponsesSearchResponse } from './types.js'

/** Extract provider-generated text without rewriting citation markers. */
export function extractResponsesText(response: ResponsesSearchResponse): string {
  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text
  }
  const chunks: string[] = []
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    if (typeof item.output_text === 'string') chunks.push(item.output_text)
    for (const part of item.content ?? []) {
      if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('')
}

/** Map only structured URL citations to normalized Web sources. */
export function extractResponsesSources(response: ResponsesSearchResponse): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== 'url_citation' || typeof annotation.url !== 'string' || annotation.url.length === 0) continue
        if (seen.has(annotation.url)) continue
        seen.add(annotation.url)
        const title = nonBlank(annotation.title)
        sources.push({
          url: annotation.url,
          ...title === undefined ? {} : { title },
        })
      }
    }
  }
  return sources
}

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

/** Add streamed text to a completed response without mutating caller-owned data. */
export function withStreamedText(response: ResponsesSearchResponse, text: string): ResponsesSearchResponse {
  if (text.length === 0 || (typeof response.output_text === 'string' && response.output_text.length > 0)) {
    return response
  }
  return { ...response, output_text: text }
}
