import { expect, test } from "vitest";
import { statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManualClock } from "@usagekit/store";
import { createSqliteStore } from "./index.js";
import { encode, decode, integer } from "./serialize.js";
test("serialization is exact and integer bounds reject overflow", () => {
  const data = { money: { units: 2n ** 63n - 1n }, literal: "bigint:7" };
  expect(decode(encode(data))).toEqual(data);
  expect(integer(null)).toBeNull();
  expect(() => integer(2n ** 63n)).toThrow("INTEGER bound");
  expect(() => integer(-(2n ** 63n) - 1n)).toThrow();
});
test("database permissions are private and cursor snapshots expire", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-storage-")),
    clock = createManualClock(),
    s = createSqliteStore({ path: join(dir, "usage.db"), clock, cursorTtlMs: 10 });
  try {
    expect(statSync(join(dir, "usage.db")).mode & 0o777).toBe(0o600);
    clock.advance(10);
    await expect(
      s.aggregate({
        scope: { kind: "namespace", namespace: "test" },
        from: "2026-09-01T00:00:00Z",
        to: "2026-10-01T00:00:00Z",
        units: [],
        groupBy: [],
        cursor: "expired",
      }),
    ).rejects.toThrow("InvalidInput");
    await s.getOperation({ namespace: "test", principal: "u", operationId: "none" });
    expect(
      s.database.prepare("SELECT name FROM sqlite_master WHERE name='cursors'").get(),
    ).toBeUndefined();
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
