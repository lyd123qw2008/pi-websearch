/**
 * Render OpenAI Responses URL annotations in a terminal-friendly format.
 *
 * The Responses API gives URL citation spans (`start_index`/`end_index`).
 * We preserve those spans by placing a compact, clickable `[n]` marker in
 * the answer and append a deduplicated source index at the end.
 */

function isUrlCitation(annotation) {
  return (
    annotation?.type === "url_citation" &&
    typeof annotation.url === "string" &&
    annotation.url.length > 0
  );
}

function escapeMarkdownLabel(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/[\[\]\r\n]/g, (character) => {
      if (character === "\r" || character === "\n") return " ";
      return `\\${character}`;
    })
    .trim();
}

function safeMarkdownUrl(url) {
  return String(url).replace(/[\r\n>]/g, (character) => {
    if (character === "\r") return "%0D";
    if (character === "\n") return "%0A";
    return "%3E";
  });
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function getTitle(annotation) {
  const title = String(annotation.title || "").trim();
  return title || getDomain(annotation.url) || annotation.url;
}

function getIndex(annotation, field) {
  const value = annotation?.[field];
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function getSortedAnnotations(part) {
  return (part?.annotations ?? [])
    .map((annotation, order) => ({ annotation, order }))
    .filter(({ annotation }) => isUrlCitation(annotation))
    .sort((left, right) => {
      const leftStart = getIndex(left.annotation, "start_index");
      const rightStart = getIndex(right.annotation, "start_index");
      if (leftStart === undefined && rightStart === undefined) {
        return left.order - right.order;
      }
      if (leftStart === undefined) return 1;
      if (rightStart === undefined) return -1;
      return leftStart - rightStart || left.order - right.order;
    });
}

function buildCitationModel(item) {
  const sources = [];
  const sourceByUrl = new Map();
  const parts = [];

  for (const part of item?.content ?? []) {
    if (part?.type !== "output_text") {
      parts.push({ text: String(part?.refusal ?? ""), citations: [] });
      continue;
    }

    const citations = [];
    for (const { annotation } of getSortedAnnotations(part)) {
      let source = sourceByUrl.get(annotation.url);
      if (!source) {
        source = {
          index: sources.length + 1,
          title: getTitle(annotation),
          url: annotation.url,
        };
        sourceByUrl.set(annotation.url, source);
        sources.push(source);
      } else if (
        source.title === getDomain(source.url) ||
        source.title === source.url
      ) {
        const title = String(annotation.title || "").trim();
        if (title) source.title = title;
      }

      citations.push({
        annotation,
        source,
      });
    }

    parts.push({
      text: String(part.text ?? ""),
      citations,
    });
  }

  return { parts, sources };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDuplicateInlineLinks(text, insertions) {
  const sources = new Map();
  for (const insertion of insertions) {
    sources.set(insertion.sourceIndex, insertion.url);
  }

  let result = text;
  for (const [sourceIndex, url] of sources) {
    const escapedUrl = escapeRegExp(url);
    const link = `\\[[^\\r\\n]*?\\]\\((?:<)?${escapedUrl}(?:>)?\\)`;
    const marker = `\\[${sourceIndex}\\]\\(<${escapedUrl}>\\)`;
    // Some gateways/models include a Markdown citation link in the generated
    // text as well as a structured annotation. Replace that adjacent duplicate
    // with the compact numbered marker instead of showing the URL twice.
    const duplicate = new RegExp(
      `(?:\\s*\\(\\s*)?${link}(?:\\s*\\))?\\s*${marker}`,
      "g",
    );
    result = result.replace(duplicate, `[${sourceIndex}](<${safeMarkdownUrl(url)}>)`);
  }
  return result;
}

function insertInlineCitations(text, citations) {
  const insertions = [];
  const seenAtPosition = new Set();

  for (const { annotation, source } of citations) {
    const endIndex = getIndex(annotation, "end_index");
    if (endIndex === undefined || endIndex > text.length) continue;

    const key = `${endIndex}:${source.index}`;
    if (seenAtPosition.has(key)) continue;
    seenAtPosition.add(key);
    insertions.push({
      endIndex,
      sourceIndex: source.index,
      url: source.url,
      marker: `[${source.index}](<${safeMarkdownUrl(source.url)}>)`,
    });
  }

  // Insert from right to left so the provider's indexes remain stable. For
  // citations ending at the same character, process higher numbers first so
  // the final visible order is [1][2], matching the source index.
  insertions.sort(
    (left, right) =>
      right.endIndex - left.endIndex || right.sourceIndex - left.sourceIndex,
  );

  let result = text;
  for (const insertion of insertions) {
    result =
      result.slice(0, insertion.endIndex) +
      insertion.marker +
      result.slice(insertion.endIndex);
  }
  return stripDuplicateInlineLinks(result, insertions);
}

function formatSources(sources) {
  if (sources.length === 0) return "";

  const lines = sources.map((source) => {
    const domain = getDomain(source.url);
    const title = escapeMarkdownLabel(source.title || domain || source.url);
    const label = domain && title !== domain
      ? `${title} · ${escapeMarkdownLabel(domain)}`
      : title;
    return `[${source.index}] [${label}](<${safeMarkdownUrl(source.url)}>)`;
  });

  return `\n\nSources:\n${lines.join("\n")}`;
}

/**
 * Return only the deduplicated source index suffix.
 * This is useful for callers that already have a separately rendered body.
 */
export function formatUrlCitations(item) {
  const { sources } = buildCitationModel(item);
  return formatSources(sources);
}

/**
 * Render output text with inline clickable citation markers and a source index.
 */
export function renderResponseText(item) {
  const { parts, sources } = buildCitationModel(item);
  const text = parts
    .map(({ text: partText, citations }) =>
      insertInlineCitations(partText, citations),
    )
    .join("");

  return cleanRawCitationTokens(text) + formatSources(sources);
}

export function cleanRawCitationTokens(text) {
  return String(text ?? "").replace(/cite[^]*/g, "").trimEnd();
}
