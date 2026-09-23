import { expect, test } from "vitest";
import type { Store } from "../src/index.js";
import { input, command, receipt, ref } from "./helpers.js";
export type ScalingFixture = {
  store: Store;
  snapshot(): { statements: number; changes: bigint; rowsRead: number };
  readOnly(run: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
};
/** SQL adapters supply counters, never an implementation-specific Store to the test. */
export function runStoreScalingConformance(factory: () => Promise<ScalingFixture>) {
  test("5000 operations do not increase command statements or changed rows", async () => {
    const f = await factory();
    const execute = async (id: string) => {
      const before = f.snapshot(),
        i = input({ operationId: id, provider: id }),
        r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      const g = await f.store.markDispatchIntent({
        ...command(r.operation),
        holder: "h",
        leaseTtlMs: 1000,
      });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      await f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: receipt(),
      });
      const after = f.snapshot();
      return {
        statements: after.statements - before.statements,
        changes: after.changes - before.changes,
        rowsRead: after.rowsRead - before.rowsRead,
      };
    };
    try {
      const small = await execute("small");
      for (let n = 0; n < 5000; n++) await f.store.reserve(input({ operationId: `seed-${n}` }));
      const large = await execute("large");
      expect(large).toEqual(small);
      expect(large.statements).toBeLessThan(75);
      expect(large.changes).toBeLessThan(30n);
      await f.readOnly(async () => {
        expect(await f.store.getOperation(ref(input({ operationId: "large" })))).toMatchObject({
          state: "settled",
        });
        await f.store.definedBudgets({
          scope: { kind: "principal", namespace: "test", principal: "u1" },
        });
        await f.store.applicableBudgets({
          scope: input().scope,
          surface: "app",
          units: ["requests"],
        });
        const q = {
            scope: { kind: "namespace" as const, namespace: "test" },
            from: "2026-09-01T00:00:00Z",
            to: "2026-10-01T00:00:00Z",
            units: ["requests"],
            groupBy: ["provider" as const],
            limit: 1,
          },
          first = await f.store.aggregate(q);
        expect(first.nextCursor).toBeTruthy();
        expect((await f.store.aggregate({ ...q, cursor: first.nextCursor! })).watermark).toBe(
          first.watermark,
        );
      });
      console.info(
        `Scaling: 5000 operations, ${large.statements} prepares, ${large.changes} changed rows, ${large.rowsRead} returned rows; same as small database. All reads and cursor pages pass read-only enforcement.`,
      );
    } finally {
      await f.close();
    }
  });
}
