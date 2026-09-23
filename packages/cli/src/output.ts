import { decodeMeterJson } from "@usagekit/core";
export const encode = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
export const decode = <T>(text: string): T => decodeMeterJson(text) as T;
export function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(encode(value));
    return;
  }
  if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === "object")) {
    const keys = [...new Set(value.flatMap((v) => Object.keys(v as object)))];
    console.log(keys.join("\t"));
    for (const row of value)
      console.log(
        keys
          .map((k) => (typeof row[k] === "object" ? encode(row[k]) : String(row[k] ?? "")))
          .join("\t"),
      );
  } else console.log(JSON.stringify(JSON.parse(encode(value)), null, 2));
}
export function rejected(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    (typeof r.outcome === "string" &&
      !["ok", "reserved", "settled", "released", "expired"].includes(r.outcome)) ||
    r.granted === false ||
    r.renewed === false ||
    r.claimed === false ||
    r.valid === false
  );
}
