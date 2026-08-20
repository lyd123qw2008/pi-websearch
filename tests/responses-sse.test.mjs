import test from "node:test";
import assert from "node:assert/strict";
import { parseSseEvents, createSseParser } from "../src/responses-sse.mjs";

test("parses Responses events split across chunks and CRLF boundaries", () => {
  const events = [];
  const parser = createSseParser((event) => events.push(event));
  parser.push("event: response.output_text.delta\r\ndata: {\"delta\":\"Hel");
  parser.push("lo\"}\r\n\r\nevent: response.completed\r\ndata: {\"response\":{\"output_text\":\"Hello\"}}\r\n\r\n");
  parser.end();

  assert.deepEqual(events, [
    {
      event: "response.output_text.delta",
      data: { delta: "Hello" },
    },
    {
      event: "response.completed",
      data: { response: { output_text: "Hello" } },
    },
  ]);
});

test("joins multiline data fields and ignores SSE comments", () => {
  assert.deepEqual(
    parseSseEvents(": keep-alive\nevent: message\ndata: {\"a\":\ndata: 1}\n\n"),
    [{ event: "message", data: { a: 1 } }],
  );
});

test("parses the Responses done sentinel as an event payload", () => {
  assert.deepEqual(parseSseEvents("data: [DONE]\n\n"), [
    { event: "message", data: "[DONE]" },
  ]);
});
