/**
 * Format OpenAI Responses URL annotations as ordinary Markdown links.
 * This mirrors the helper embedded in the Pi pi-ai patch.
 */
export function formatUrlCitations(item) {
  const seen = new Set();
  const lines = [];

  for (const part of item?.content ?? []) {
    if (part?.type !== "output_text") continue;

    for (const annotation of part.annotations ?? []) {
      if (annotation?.type !== "url_citation" || typeof annotation.url !== "string") continue;
      if (seen.has(annotation.url)) continue;

      seen.add(annotation.url);
      const title = String(annotation.title || annotation.url)
        .replace(/[\[\]\r\n]/g, (value) =>
          value === "\r" || value === "\n" ? " " : `\\${value}`,
        )
        .trim();
      const safeUrl = annotation.url.replace(/>/g, "%3E");
      lines.push(`- [${title || safeUrl}](<${safeUrl}>)`);
    }
  }

  return lines.length > 0 ? `\n\n### Sources\n${lines.join("\n")}` : "";
}

export function cleanRawCitationTokens(text) {
  return String(text ?? "").replace(/cite[^]*/g, "").trimEnd();
}
