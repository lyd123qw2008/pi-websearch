/**
 * Extract the text produced by a non-streaming OpenAI Responses result.
 *
 * The plugin deliberately returns this text unchanged to the parent Pi model.
 * Citation formatting and final answer layout belong to the model, not here.
 */
export function extractResponsesText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (
        (part?.type === "output_text" || part?.type === "text") &&
        typeof part.text === "string"
      ) {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("");
}
