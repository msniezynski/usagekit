import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Operation, OperationsQuery, ReserveInput } from "@usagekit/core";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { command, input, receipt, unknownReceipt } from "./helpers.js";
export function operationsTests(factory: StoreFactory) {
  describe("operation listing", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const query = (overrides: Partial<OperationsQuery> = {}): OperationsQuery => ({
      scope: { kind: "namespace", namespace: "test" },
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      ...overrides,
    });
    const reserved = async (overrides: Partial<ReserveInput> = {}): Promise<Operation> => {
      const r = await f.store.reserve(input(overrides));
      if (r.outcome !== "reserved") throw new Error("fixture");
      f.clock.advance(1000);
      return r.operation;
    };
    const dispatched = async (overrides: Partial<ReserveInput> = {}) => {
      const op = await reserved(overrides);
      const g = await f.store.markDispatchIntent({
        ...command(op),
        holder: "h",
        leaseTtlMs: 60000,
      });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      return g;
    };
    const settledWith = async (unknown: boolean, overrides: Partial<ReserveInput> = {}) => {
      const g = await dispatched(overrides);
      const s = await f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: unknown ? unknownReceipt() : receipt(),
      });
      if (s.outcome !== "settled") throw new Error("fixture");
      return s.operation;
    };
    const ids = (ops: readonly Operation[]) => ops.map((o) => o.operationId);
    test("lists every state by default and filters by state in creation order", async () => {
      const a = await reserved(),
        b = (await dispatched()).operation,
        c = await settledWith(true),
        d = await settledWith(false);
      expect(c.state).toBe("pending");
      expect(d.state).toBe("settled");
      const all = await f.store.listOperations(query());
      expect(ids(all.operations)).toEqual(ids([a, b, c, d]));
      expect(all.nextCursor).toBeUndefined();
      expect(all.asOf).toBe(f.clock.now().toISOString());
      expect(typeof all.watermark).toBe("string");
      const open = await f.store.listOperations(query({ states: ["reserved", "pending"] }));
      expect(ids(open.operations)).toEqual([a.operationId, c.operationId]);
      expect(open.operations[1]!.state).toBe("pending");
      expect(open.operations[1]!.receipts).toHaveLength(1);
      expect(
        ids((await f.store.listOperations(query({ states: ["dispatch_intended"] }))).operations),
      ).toEqual([b.operationId]);
    });
    test("scope and connection narrow the listing without widening it", async () => {
      const own = await reserved({
          scope: { namespace: "test", principal: "u1", connection: "c1", group: "g1" },
          platformPools: ["p1"],
        }),
        other = await reserved({
          scope: { namespace: "test", principal: "u2", connection: "c2" },
          costOwner: "u2",
        });
      await f.store.reserve(
        input({ scope: { namespace: "other", principal: "u1", connection: "c1" } }),
      );
      const list = async (o: Partial<OperationsQuery>) =>
        ids((await f.store.listOperations(query(o))).operations);
      expect(await list({})).toEqual([own.operationId, other.operationId]);
      expect(
        await list({ scope: { kind: "principal", namespace: "test", principal: "u2" } }),
      ).toEqual([other.operationId]);
      expect(await list({ scope: { kind: "group", namespace: "test", group: "g1" } })).toEqual([
        own.operationId,
      ]);
      expect(
        await list({ scope: { kind: "platform_pool", namespace: "test", poolId: "p1" } }),
      ).toEqual([own.operationId]);
      expect(await list({ connection: "c2" })).toEqual([other.operationId]);
    });
    test("the window is createdAt from inclusive to exclusive", async () => {
      const first = await reserved(),
        second = await reserved();
      const list = async (from: string, to: string) =>
        ids((await f.store.listOperations(query({ from, to }))).operations);
      expect(await list(first.createdAt, second.createdAt)).toEqual([first.operationId]);
      expect(await list(second.createdAt, "2026-10-01T00:00:00.000Z")).toEqual([
        second.operationId,
      ]);
      expect(await list("2026-09-01T00:00:00.000Z", first.createdAt)).toEqual([]);
    });
    test("pages keep first-page membership and reject a changed query", async () => {
      const a = await reserved(),
        b = await reserved(),
        c = await reserved();
      const first = await f.store.listOperations(query({ limit: 2 }));
      expect(ids(first.operations)).toEqual([a.operationId, b.operationId]);
      expect(first.nextCursor).toBeTruthy();
      await reserved();
      const second = await f.store.listOperations(query({ limit: 2, cursor: first.nextCursor! }));
      expect(ids(second.operations)).toEqual([c.operationId]);
      expect(second.nextCursor).toBeUndefined();
      expect(second.watermark).toBe(first.watermark);
      expect(second.asOf).toBe(first.asOf);
      await expect(
        f.store.listOperations(query({ limit: 1, cursor: first.nextCursor! })),
      ).rejects.toThrow("InvalidInput");
      await expect(f.store.listOperations(query({ limit: 2, cursor: "forged" }))).rejects.toThrow(
        "InvalidInput",
      );
    });
  });
}
