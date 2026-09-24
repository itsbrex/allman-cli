/** RFC 9110 Retry-After: nonnegative seconds or an HTTP date; never invent a cooldown. */
export function retryAfterSeconds(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  if (!/^[A-Za-z]{3,9}[, ]/.test(text)) return undefined;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : undefined;
}

/** Diagnostics exclude query strings, fragments and URL credentials. Raw evidence is separate. */
export function requestEndpoint(value: string): string {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    const path = url.pathname.replace(
      /(?:authToken|access_token|token)(?::|%3A|=)[^,)/]+/gi,
      "token:REDACTED"
    );
    return `${url.origin}${path}`;
  } catch {
    return "invalid-endpoint";
  }
}
