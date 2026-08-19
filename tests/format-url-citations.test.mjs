import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanRawCitationTokens,
  formatUrlCitations,
  renderResponseText,
} from "../src/format-url-citations.mjs";

test("renders a complete clickable URL next to the supported claim", () => {
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
        ],
      },
    ],
  });

  assert.ok(
    result.includes(
      "Source one supports this answer ([https://example.com/one](<https://example.com/one>));",
    ),
  );
  assert.ok(
    result.includes(
      "source two adds context ([https://example.com/two?a=1&b=2](<https://example.com/two?a=1&b=2>)).",
    ),
  );
  assert.ok(!result.includes("Sources:"));
  assert.ok(!result.includes("来源："));
  assert.ok(!result.includes("[[1]]"));
});

test("does not duplicate a URL already emitted by the model", () => {
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

  assert.equal(result, text);
  assert.equal((result.match(/https:\/\/example\.com\/source/g) ?? []).length, 1);
});

test("does not duplicate a model URL when span positions are missing", () => {
  const text = "事实。 (https://example.com/source)";
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
          },
        ],
      },
    ],
  });

  assert.equal(result, text);
});

test("shows a repeated source only once", () => {
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

  assert.equal(
    (result.match(/\(\[https:\/\/example\.com\/source\]\(<https:\/\/example\.com\/source>\)\)/g) ?? [])
      .length,
    1,
  );
  assert.ok(
    result.includes(
      "First claim. ([https://example.com/source](<https://example.com/source>))",
    ),
  );
  assert.ok(result.includes("Second claim."));
});

test("keeps a source-only fallback when annotations have no span indexes", () => {
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
    result,
    "Answer without usable span indexes.\n\n([https://example.com/fallback](<https://example.com/fallback>))",
  );
});

test("orders multiple sources at the same position", () => {
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
      "Claim. ([https://example.com/first](<https://example.com/first>))\n([https://example.com/second](<https://example.com/second>))",
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

  assert.ok(
    result.includes(
      "原生搜索 ([https://example.com/search](<https://example.com/search>))已经启用。",
    ),
  );
});

test("formatUrlCitations returns source fallback text", () => {
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
    "\n\n([https://example.com/source](<https://example.com/source>))",
  );
});

test("returns plain text without a source suffix when there are no citations", () => {
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
