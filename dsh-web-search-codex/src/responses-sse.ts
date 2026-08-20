/** Incremental parser for Responses Server-Sent Events. */

/** One parsed Responses SSE event. */
export interface ResponsesSseEvent {
  readonly event: string
  readonly data: unknown
}

/**
 * Create an incremental parser tolerant of arbitrary chunks, CRLF, comments,
 * multiline data fields, and the `[DONE]` sentinel.
 * @param onEvent - callback invoked for each complete event.
 * @returns parser controller.
 */
export function createResponsesSseParser(
  onEvent: (event: ResponsesSseEvent) => void,
): { push(chunk: string): void; end(): void } {
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  const dispatch = (): void => {
    if (dataLines.length === 0) {
      eventName = ''
      return
    }
    const text = dataLines.join('\n')
    let data: unknown = text
    if (text !== '[DONE]') data = JSON.parse(text) as unknown
    onEvent({ event: eventName || 'message', data })
    eventName = ''
    dataLines = []
  }

  const processLine = (line: string): void => {
    if (line.length === 0) {
      dispatch()
      return
    }
    if (line.startsWith(':')) return
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    let value = separator < 0 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    if (field === 'data') dataLines.push(value)
  }

  return {
    push(chunk: string): void {
      buffer += chunk
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        processLine(line)
      }
    },
    end(): void {
      if (buffer.length > 0) {
        let line = buffer
        buffer = ''
        if (line.endsWith('\r')) line = line.slice(0, -1)
        processLine(line)
      }
      dispatch()
    },
  }
}

/** Consume a Responses SSE response with the caller's abort signal. */
export async function consumeResponsesSseResponse(
  response: Response,
  onEvent: (event: ResponsesSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (response.body === null) throw new Error('Responses streaming response has no body')
  const reader = response.body.getReader()
  const parser = createResponsesSseParser(onEvent)
  const decoder = new TextDecoder()
  let removeAbortListener: (() => void) | undefined

  if (signal !== undefined) {
    const cancel = (): void => {
      void reader.cancel().catch(() => {
        // Cancellation already owns the operation result.
      })
    }
    if (signal.aborted) {
      cancel()
      throw new Error('Responses streaming request aborted', { cause: signal.reason })
    }
    signal.addEventListener('abort', cancel, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', cancel)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.end()
  } finally {
    removeAbortListener?.()
    reader.releaseLock()
  }
}
