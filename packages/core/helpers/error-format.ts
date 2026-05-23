export function formatErrorForLog(error: unknown): string {
  return flattenError(error).join(" | caused by ");
}

function flattenError(error: unknown): string[] {
  const details: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && !seen.has(current)) {
    seen.add(current);
    details.push(formatSingleError(current));
    current = isRecord(current) ? current.cause : null;
  }

  return details.length > 0 ? details : [truncate(String(error), 2_000)];
}

function formatSingleError(error: unknown): string {
  if (!isRecord(error)) {
    return truncate(String(error), 2_000);
  }

  const name = typeof error.name === "string" ? error.name : "Error";
  const message = typeof error.message === "string" ? error.message : String(error);
  const parts = [`${name}: ${truncate(message, 2_000)}`];

  const finishReason = stringValue(error.finishReason);
  if (finishReason) parts.push(`finishReason=${finishReason}`);

  const response = isRecord(error.response) ? error.response : null;
  const responseId = stringValue(response?.id);
  if (responseId) parts.push(`responseId=${responseId}`);

  const usage = isRecord(error.usage) ? error.usage : null;
  const totalTokens = numberValue(usage?.totalTokens);
  if (totalTokens != null) parts.push(`totalTokens=${totalTokens}`);

  const text = stringValue(error.text);
  if (text) parts.push(`textPreview=${JSON.stringify(truncate(text, 1_000))}`);

  const value = "value" in error ? error.value : undefined;
  if (value !== undefined) parts.push(`valuePreview=${truncate(safeJson(value), 1_000)}`);

  return parts.join(" ");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...<truncated>` : value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
