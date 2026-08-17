import test from "node:test";
import assert from "node:assert/strict";
import { cleanRawCitationTokens, formatUrlCitations } from "../src/format-url-citations.mjs";

test("formats URL annotations as a deduplicated Markdown sources section", () => {
  const result = formatUrlCitations({
    content: [
      {
        type: "output_text",
        text: "answer",
        annotations: [
          { type: "url_citation", title: "Source [one]", url: "https://example.com/one" },
          { type: "url_citation", title: "Duplicate", url: "https://example.com/one" },
          { type: "url_citation", title: "Source two", url: "https://example.com/two?a=1&b=2" },
        ],
      },
    ],
  });

  assert.equal(
    result,
    "\n\n### Sources\n- [Source \\[one\\]](<https://example.com/one>)\n- [Source two](<https://example.com/two?a=1&b=2>)",
  );
});

test("returns an empty string without URL citations", () => {
  assert.equal(formatUrlCitations({ content: [{ type: "output_text", text: "answer", annotations: [] }] }), "");
});

test("removes raw platform citation tokens", () => {
  assert.equal(cleanRawCitationTokens("Answer citeturn1view0"), "Answer");
});
