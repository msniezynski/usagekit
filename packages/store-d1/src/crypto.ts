import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
const utf8 = new TextEncoder();
export const hash = (text: string) =>
  Array.from(sha256(utf8.encode(text)), (b) => b.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const encodeText = (text: string) => base64(utf8.encode(text));
export const decodeText = (text: string) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  );
export const signCursor = (secret: string, body: string) =>
  base64(hmac(sha256, utf8.encode(secret), utf8.encode(body)));
/** Both MACs have the same public length; never exit early on their contents. */
export function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
