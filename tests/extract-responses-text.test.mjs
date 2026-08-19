import test from "node:test";
import assert from "node:assert/strict";
import { extractResponsesText } from "../src/extract-responses-text.mjs";

test("prefers the canonical Responses output_text", () => {
  assert.equal(
    extractResponsesText({
      output_text: "Codex search result with the user's requested format.",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "fallback" }],
        },
      ],
    }),
    "Codex search result with the user's requested format.",
  );
});

test("extracts text from message content when output_text is absent", () => {
  assert.equal(
    extractResponsesText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "First result." },
            { type: "output_text", text: " Second result." },
          ],
        },
      ],
    }),
    "First result. Second result.",
  );
});

test("ignores non-message and non-text output items", () => {
  assert.equal(
    extractResponsesText({
      output: [
        { type: "web_search_call", action: { sources: [] } },
        {
          type: "message",
          content: [
            { type: "reasoning", text: "hidden reasoning" },
            { type: "output_text", text: "Visible result." },
          ],
        },
      ],
    }),
    "Visible result.",
  );
});

test("returns an empty string when the response has no text", () => {
  assert.equal(extractResponsesText({ output: [] }), "");
  assert.equal(extractResponsesText(undefined), "");
});
