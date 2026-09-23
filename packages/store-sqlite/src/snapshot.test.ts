import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createManualClock } from "@usagekit/store";
import { createSqliteStore } from "./index.js";
test("cursor snapshot survives reopen, ignores later correction, expires without writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-snapshot-")),
    path = join(dir, "usage.db"),
    clock = createManualClock();
  let s = createSqliteStore({ path, clock, cursorTtlMs: 100 });
  try {
    const saved = [];
    for (const provider of ["a", "b"]) {
      const i = {
        operationId: provider,
        scope: { namespace: "test", principal: "u", connection: "c" },
        fundingSource: "byok" as const,
        costOwner: "u",
        surface: "app" as const,
        source: "app" as const,
        provider,
        operation: "search",
        estimate: [{ unit: "requests", value: 1n, scale: 0 }],
      };
      await s.reserve(i);
      const ref = { namespace: "test", principal: "u", operationId: provider },
        g = await s.markDispatchIntent({
          ...ref,
          commandId: "intent",
          expectedVersion: 1,
          holder: "h",
          leaseTtlMs: 1000,
        });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      const r = await s.settle({
        ...ref,
        commandId: "settle",
        expectedVersion: 2,
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: {
          id: "r",
          measurements: [
            {
              unit: "requests",
              quantity: { unit: "requests", value: 1n, scale: 0 },
              certainty: "measured",
            },
          ],
          cost: { certainty: "measured", money: { currency: "USD", units: 1n } },
          occurredAt: clock.now().toISOString(),
          recordedAt: clock.now().toISOString(),
          cached: false,
          failed: false,
        },
      });
      if (r.outcome !== "settled") throw new Error("fixture");
      saved.push(r.operation);
    }
    const q = {
        scope: { kind: "namespace" as const, namespace: "test" },
        from: "2026-09-01T00:00:00Z",
        to: "2026-10-01T00:00:00Z",
        units: ["requests"],
        groupBy: ["provider" as const],
        limit: 1,
      },
      first = await s.aggregate(q),
      op = saved[1]!;
    await s.correct({
      namespace: "test",
      principal: "u",
      operationId: op.operationId,
      expectedVersion: op.version,
      commandId: "correct",
      authority: { kind: "late_evidence", source: "test" },
      replacesReceiptId: "r",
      reason: "correction",
      receipt: {
        ...op.receipts[0]!,
        id: "new",
        cost: { certainty: "measured", money: { currency: "USD", units: 100n } },
      },
    });
    s.close();
    s = createSqliteStore({ path, clock, cursorTtlMs: 100 });
    s.database.pragma("query_only = ON");
    const second = await s.aggregate({ ...q, cursor: first.nextCursor! });
    expect(second.rows[0]!.cost.money?.units).toBe(1n);
    expect(second.watermark).toBe(first.watermark);
    expect((await s.aggregate({ ...q, limit: 100 })).rows[1]!.cost.money?.units).toBe(100n);
    await expect(s.aggregate({ ...q, cursor: first.nextCursor! + "tampered" })).rejects.toThrow(
      "InvalidInput",
    );
    clock.advance(100);
    await expect(s.aggregate({ ...q, cursor: first.nextCursor! })).rejects.toThrow("InvalidInput");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
