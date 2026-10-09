import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { usageProgress } = await import(
  /* @vite-ignore */ pathToFileURL(
    join(import.meta.dirname, "../registry/radix/usage-progress/usage-progress.tsx"),
  ).href
);

describe("authoritative host usage progress", () => {
  test("distinguishes known zero from unsettled zero", () => {
    expect(usageProgress(0, false)).toEqual({ kind: "known", percent: 0, level: "ok" });
    expect(usageProgress(0, true)).toEqual({ kind: "unknown", percent: null, level: "ok" });
  });
  test("preserves a partial lower bound and over-limit state", () => {
    expect(usageProgress(62.75, true)).toEqual({ kind: "partial", percent: 62.75, level: "ok" });
    expect(usageProgress(180, false)).toEqual({ kind: "known", percent: 180, level: "exceeded" });
    expect(usageProgress(80, false).level).toBe("warning");
  });
  test("missing and invalid readings never become a zero meter", () => {
    expect(usageProgress(null, true).kind).toBe("none");
    for (const invalid of [NaN, Infinity, -1]) {
      expect(usageProgress(invalid, false)).toEqual({
        kind: "unknown",
        percent: null,
        level: "ok",
      });
    }
  });
});
