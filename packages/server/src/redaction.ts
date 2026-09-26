import type { ProviderDescriptor } from "@usagekit/core";
const sensitive =
  /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|access[-_]?token|secret|password|login|email|account[-_]?email|account[-_]?identity)$/i;
/** Redact both structured fields and secrets echoed inside URLs or free text. */
export function redactFixture(
  value: unknown,
  descriptor: ProviderDescriptor,
  secrets: readonly string[],
): unknown {
  const tokens = [
    ...new Set(
      secrets
        .filter(Boolean)
        .flatMap((s) => [s, encodeURIComponent(s), Buffer.from(s).toString("base64")]),
    ),
  ].sort((a, b) => b.length - a.length);
  const clean = (text: string): string => {
    for (const token of tokens) text = text.split(token).join("REDACTED");
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "REDACTED");
    return text.replace(/([?&](?:api_key|apikey|token|access_token|key)=)[^&#\s]*/gi, "$1REDACTED");
  };
  const visit = (data: unknown): unknown => {
    if (typeof data === "string") return clean(data);
    if (Array.isArray(data)) return data.map(visit);
    if (data && typeof data === "object")
      return Object.fromEntries(
        Object.entries(data).map(([key, v]) => [
          clean(key),
          sensitive.test(key) ||
          (descriptor.auth.kind === "query" && key === descriptor.auth.param) ||
          (descriptor.auth.kind === "header" &&
            key.toLowerCase() === descriptor.auth.name.toLowerCase())
            ? "REDACTED"
            : visit(v),
        ]),
      );
    return data;
  };
  return visit(value);
}
