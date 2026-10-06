export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const host = new URL(url).host;
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some APIs (GDELT) answer 200 with a plain-text explanation; keep it for the source note.
    throw new Error(`${host}: ${text.slice(0, 160).trim()}`);
  }
}
