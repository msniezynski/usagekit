import type { ProviderDescriptor, ProviderOperation, RequestMatch } from "@usagekit/core";
import type { ProviderRequest } from "./types.js";

type Score = [literal: number, query: number, method: number];

function pathScore(pattern: string, path: string): number | null {
  const want = pattern.split("/").filter(Boolean),
    have = path.split("/").filter(Boolean);
  let literal = 0;
  for (let i = 0; i < want.length; i++) {
    const segment = want[i]!;
    if (segment === "*" && i === want.length - 1) return literal;
    if (i >= have.length) return null;
    if (segment.startsWith(":")) continue;
    if (segment !== have[i]) return null;
    literal += segment.length + 1;
  }
  return want.length === have.length ? literal : null;
}

function score(
  m: RequestMatch,
  method: string,
  path: string,
  query: URLSearchParams,
): Score | null {
  if (m.method !== "ANY" && m.method !== method) return null;
  const literal = pathScore(m.path, path);
  if (literal === null) return null;
  const constraints = Object.entries(m.query ?? {});
  for (const [key, expected] of constraints) {
    const actual = query.get(key);
    if (actual === null) return null;
    if (typeof expected === "string" ? actual !== expected : !expected.test(actual)) return null;
  }
  return [literal, constraints.length, m.method === "ANY" ? 0 : 1];
}

const better = (a: Score, b: Score) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/**
 * The operation for a request: the longest literal path wins, then most query constraints, then
 * an exact method over ANY. The request must target the upstream origin and base path.
 */
export function matchOperation(
  descriptor: ProviderDescriptor,
  request: ProviderRequest,
): ProviderOperation | undefined {
  const upstream = new URL(descriptor.upstream),
    url = new URL(request.url, upstream);
  if (url.origin !== upstream.origin) return undefined;
  const base = upstream.pathname.replace(/\/$/, "");
  if (base && url.pathname !== base && !url.pathname.startsWith(base + "/")) return undefined;
  const path = url.pathname.slice(base.length) || "/",
    method = request.method.toUpperCase();
  let best: { op: ProviderOperation; score: Score } | undefined;
  for (const op of descriptor.operations)
    for (const m of op.match) {
      const s = score(m, method, path, url.searchParams);
      if (s && (!best || better(s, best.score))) best = { op, score: s };
    }
  return best?.op;
}
