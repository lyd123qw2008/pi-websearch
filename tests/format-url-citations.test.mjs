import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanRawCitationTokens,
  formatUrlCitations,
  renderResponseText,
} from "../src/format-url-citations.mjs";

test("renders inline clickable markers and a deduplicated source index", () => {
  const result = renderResponseText({
    content: [
      {
        type: "output_text",
        text: "Source one supports this answer; source two adds context.",
        annotations: [
          {
            type: "url_citation",
            title: "Source [one]",
            url: "https://example.com/one",
            start_index: 0,
            end_index: 31,
          },
          {
            type: "url_citation",
            title: "Source two",
            url: "https://example.com/two?a=1&b=2",
            start_index: 33,
            end_index: 56,
          },
          {
            type: "url_citation",
            title: "Duplicate",
            url: "https://example.com/one",
            start_index: 0,
            end_index: 31,
          },
        ],
      },
    ],
  });

  assert.ok(
    result.includes(
      "Source one supports this answer[\\[1\\]](<https://example.com/one>); source two adds context[\\[2\\]](<https://example.com/two?a=1&b=2>).",
    ),
  );
  assert.ok(
    result.includes(
      "[1] [Source \\\[one\\\] · example.com](<https://example.com/one>)",
    ),
  );
  assert.ok(
    result.includes(
      "[2] [Source two · example.com](<https://example.com/two?a=1&b=2>)",
    ),
  );
  assert.equal((result.match(/https:\/\/example\.com\/one/g) ?? []).length, 2);
});

test("normalizes a duplicate Markdown citation link emitted by the gateway", () => {
  const text = "事实。 ([example.com](https://example.com/source))";
  const result = renderResponseText({
    content: [
      {
        type: "output_text",
        text,
        annotations: [
          {
            type: "url_citation",
            title: "Source",
            url: "https://example.com/source",
            start_index: 0,
            end_index: text.length,
          },
        ],
      },
    ],
  });

  assert.ok(result.includes("事实。[\\[1\\]](<https://example.com/source>)"));
  assert.equal((result.match(/https:\/\/example\.com\/source/g) ?? []).length, 2);
});

test("uses the same source number for repeated citations", () => {
  const result = renderResponseText({
    content: [
      {
        type: "output_text",
        text: "First claim. Second claim.",
        annotations: [
          {
            type: "url_citation",
            title: "One source",
            url: "https://example.com/source",
            start_index: 0,
            end_index: 12,
          },
          {
            type: "url_citation",
            title: "One source",
            url: "https://example.com/source",
            start_index: 14,
            end_index: 26,
          },
        ],
      },
    ],
  });

  assert.ok(result.includes("First claim.[\\[1\\]](<https://example.com/source>)"));
  assert.ok(result.includes("Second claim.[\\[1\\]](<https://example.com/source>)"));
  assert.equal((result.match(/\[1\] \[/g) ?? []).length, 1);
});

test("keeps source-only fallback when annotations have no span indexes", () => {
  const result = renderResponseText({
    content: [
      {
        type: "output_text",
        text: "Answer without usable span indexes.",
        annotations: [
          {
            type: "url_citation",
            title: "Fallback source",
            url: "https://example.com/fallback",
          },
        ],
      },
    ],
  });

  assert.equal(
    result.split("Sources:")[0].trimEnd(),
    "Answer without usable span indexes.",
  );
  assert.ok(
    result.includes(
      "[1] [Fallback source · example.com](<https://example.com/fallback>)",
    ),
  );
});

test("orders citations at the same position as [1][2]", () => {
  const result = renderResponseText({
    content: [
      {
        type: "output_text",
        text: "Claim.",
        annotations: [
          {
            type: "url_citation",
            title: "First",
            url: "https://example.com/first",
            start_index: 0,
            end_index: 6,
          },
          {
            type: "url_citation",
            title: "Second",
            url: "https://example.com/second",
            start_index: 0,
            end_index: 6,
          },
        ],
      },
    ],
  });

  assert.ok(
    result.includes(
      "Claim.[\\[1\\]](<https://example.com/first>)[\\[2\\]](<https://example.com/second>)",
    ),
  );
});

test("handles CJK text indexes without changing the source text", () => {
  const result = renderResponseText({
    content: [
      {
        type: "output_text",
        text: "原生搜索已经启用。",
        annotations: [
          {
            type: "url_citation",
            title: "Native search",
            url: "https://example.com/search",
            start_index: 0,
            end_index: 4,
          },
        ],
      },
    ],
  });

  assert.ok(result.includes("原生搜索[\\[1\\]](<https://example.com/search>)已经启用。"));
});

test("formatUrlCitations returns only the source suffix", () => {
  assert.equal(
    formatUrlCitations({
      content: [
        {
          type: "output_text",
          text: "answer",
          annotations: [
            {
              type: "url_citation",
              title: "Source",
              url: "https://example.com/source",
            },
          ],
        },
      ],
    }),
    "\n\nSources:\n[1] [Source · example.com](<https://example.com/source>)",
  );
});

test("returns plain text without a source section when there are no citations", () => {
  assert.equal(
    renderResponseText({
      content: [{ type: "output_text", text: "answer", annotations: [] }],
    }),
    "answer",
  );
});

test("removes raw platform citation tokens", () => {
  assert.equal(cleanRawCitationTokens("Answer citeturn1view0"), "Answer");
  assert.equal(
    renderResponseText({
      content: [
        {
          type: "output_text",
          text: "Answer citeturn1view0",
          annotations: [],
        },
      ],
    }),
    "Answer",
  );
});
