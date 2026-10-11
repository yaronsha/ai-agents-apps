export interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

/**
 * Reads a push message. A body that is not JSON (or not an object) still shows a notification,
 * with the text as its body: a push that shows nothing can make iOS drop the subscription.
 */
export function readPushPayload(data: { json(): unknown; text(): string } | null | undefined): PushPayload {
  if (!data) return {};
  try {
    const parsed = data.json();
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as PushPayload;
  } catch {
    /* not JSON: fall through to the plain text */
  }
  try {
    const text = data.text().trim();
    return text ? { body: text.slice(0, 300) } : {};
  } catch {
    return {};
  }
}
