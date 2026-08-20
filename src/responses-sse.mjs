/**
 * Small Server-Sent Events parser for OpenAI Responses streaming payloads.
 * It keeps provider-specific event handling in the extension while making
 * chunk-boundary and CRLF behavior independently testable.
 */

/**
 * Create an incremental SSE parser.
 *
 * @param {(event: { event: string, data: unknown }) => void} onEvent
 */
export function createSseParser(onEvent) {
  let buffer = "";
  let eventName = "";
  let dataLines = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = "";
      return;
    }

    const text = dataLines.join("\n");
    let data = text;
    if (text !== "[DONE]") {
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error(`Invalid Responses SSE event data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    onEvent({ event: eventName || "message", data });
    eventName = "";
    dataLines = [];
  };

  const processLine = (line) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") eventName = value;
    if (field === "data") dataLines.push(value);
  };

  return {
    /** Feed one decoded text chunk into the parser. */
    push(chunk) {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        processLine(line);
      }
    },

    /** Flush the final unterminated line/event, if any. */
    end() {
      if (buffer.length > 0) {
        let line = buffer;
        buffer = "";
        if (line.endsWith("\r")) line = line.slice(0, -1);
        processLine(line);
      }
      dispatch();
    },
  };
}

/** Parse a complete SSE payload. Useful for tests and diagnostics. */
export function parseSseEvents(text) {
  const events = [];
  const parser = createSseParser((event) => events.push(event));
  parser.push(text);
  parser.end();
  return events;
}

/**
 * Consume an HTTP SSE response and call onEvent for each parsed event.
 *
 * @param {Response} response
 * @param {(event: { event: string, data: unknown }) => void} onEvent
 * @param {AbortSignal | undefined} signal
 */
export async function consumeSseResponse(response, onEvent, signal) {
  if (!response.body) throw new Error("Responses streaming payload has no body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  let removeAbortListener;

  if (signal) {
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    if (signal.aborted) {
      cancel();
      signal.throwIfAborted?.();
      throw new Error("Responses streaming request aborted");
    }
    signal.addEventListener("abort", cancel, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", cancel);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    removeAbortListener?.();
    reader.releaseLock();
  }
}
