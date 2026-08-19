/**
 * Render OpenAI Responses URL annotations in a terminal-friendly format.
 *
 * The Responses API gives URL citation spans (`start_index`/`end_index`).
 * We preserve those spans by placing a compact, inline domain link next to
 * the supported claim. The TUI shows the domain while OSC-8 keeps the full URL
 * as the hyperlink destination.
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

function formatInlineSource(source) {
  const label = escapeMarkdownLabel(
    getDomain(source.url) || source.title || source.url,
  );
  return `([${label}](<${safeMarkdownUrl(source.url)}>))`;
}

function insertInlineSources(text, citations, representedUrls) {
  const insertions = [];
  const seenAtPosition = new Set();
  const sourceCountAtEnd = new Map();

  for (const { annotation, source } of citations) {
    const endIndex = getIndex(annotation, "end_index");
    if (endIndex === undefined || endIndex > text.length) continue;

    // If the model already printed the URL, keep that source and do not add a
    // second copy. This makes the formatter safe for agents that emit inline
    // source text themselves.
    if (text.includes(source.url)) {
      representedUrls.add(source.url);
      continue;
    }
    if (representedUrls.has(source.url)) continue;

    const key = `${endIndex}:${source.url}`;
    if (seenAtPosition.has(key)) continue;
    seenAtPosition.add(key);
    representedUrls.add(source.url);
    const countAtEnd = sourceCountAtEnd.get(endIndex) ?? 0;
    sourceCountAtEnd.set(endIndex, countAtEnd + 1);
    insertions.push({
      endIndex,
      sourceIndex: source.index,
      marker: `${countAtEnd === 0 ? " " : "\n"}${formatInlineSource(source)}`,
    });
  }

  // Insert from right to left so provider indexes remain stable. For sources
  // ending at the same character, preserve annotation order on separate lines.
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
  return result;
}

function formatSourceFallback(sources) {
  if (sources.length === 0) return "";
  return `\n\n${sources.map(formatInlineSource).join("\n")}`;
}

/**
 * Return only the deduplicated fallback source-link suffix.
 * This is useful for callers that already have a separately rendered body.
 */
export function formatUrlCitations(item) {
  const { sources } = buildCitationModel(item);
  return formatSourceFallback(sources);
}

/**
 * Render output text with inline domain links next to supported claims.
 * Sources without usable span positions are appended as a fallback.
 */
export function renderResponseText(item) {
  const { parts, sources } = buildCitationModel(item);
  const representedUrls = new Set();
  const text = parts
    .map(({ text: partText, citations }) =>
      insertInlineSources(partText, citations, representedUrls),
    )
    .join("");
  const cleanedText = cleanRawCitationTokens(text);
  const fallbackSources = sources.filter(
    (source) =>
      !representedUrls.has(source.url) && !cleanedText.includes(source.url),
  );

  return cleanedText + formatSourceFallback(fallbackSources);
}

export function cleanRawCitationTokens(text) {
  return String(text ?? "").replace(/cite[^]*/g, "").trimEnd();
}
