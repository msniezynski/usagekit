import { beforeEach, afterEach, describe, test, expect } from "vitest";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, budget, quantity, ref, command } from "./helpers.js";
export function expirationTests(factory: StoreFactory) {
  describe("undispatched reservation expiry", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    test("finite default deadline is snapshotted; replay cannot extend it", async () => {
      const i = input(),
        r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      expect(r.operation.reservationExpiresAt).toBe(
        new Date(f.clock.now().getTime() + 300000).toISOString(),
      );
      f.clock.advance(1000);
      expect(await f.store.reserve(i)).toEqual({ ...r, replayed: true });
    });
    test("process loss before intent releases headroom on the next reserve", async () => {
      f.budgets.push(budget({ limit: quantity(1n) }));
      const i = input({ reservationTtlMs: 1000 });
      await f.store.reserve(i);
      f.clock.advance(1000);
      expect(await f.store.reserve(input())).toMatchObject({ outcome: "reserved" });
      expect(await f.store.getOperation(ref(i))).toMatchObject({ state: "released", version: 2 });
      expect(await f.store.reserve(i)).toMatchObject({
        replayed: true,
        operation: { state: "released" },
      });
    });
    test("expiry fences intent, sweeps are bounded and repeatable", async () => {
      const i = input({ reservationTtlMs: 1 }),
        r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      await f.store.reserve(input({ reservationTtlMs: 1 }));
      await f.store.reserve(input({ reservationTtlMs: 1 }));
      f.clock.advance(1);
      expect(
        await f.store.markDispatchIntent({
          ...command(r.operation),
          holder: "h",
          leaseTtlMs: 1000,
        }),
      ).toMatchObject({
        granted: false,
        reason: "reservation_expired",
        operation: { state: "released", version: 2 },
      });
      expect(await f.store.expireReservations({ namespace: "test", limit: 1 })).toEqual({
        outcome: "expired",
        count: 1,
        hasMore: true,
      });
      expect(await f.store.expireReservations({ namespace: "test", limit: 1 })).toEqual({
        outcome: "expired",
        count: 1,
        hasMore: false,
      });
      expect(await f.store.expireReservations({ namespace: "test" })).toEqual({
        outcome: "expired",
        count: 0,
        hasMore: false,
      });
    });
    test("dispatch intent is never released by reservation expiry, even after its lease expires", async () => {
      f.budgets.push(budget({ limit: quantity(1n) }));
      const i = input({ reservationTtlMs: 1 }),
        r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      expect(
        await f.store.markDispatchIntent({ ...command(r.operation), holder: "h", leaseTtlMs: 10 }),
      ).toMatchObject({ granted: true });
      f.clock.advance(11);
      expect(await f.store.expireReservations({ namespace: "test" })).toMatchObject({ count: 0 });
      expect(await f.store.reserve(input())).toMatchObject({ outcome: "exceeded" });
      expect(
        await f.store.claimForRecovery({ ...ref(i), holder: "recovery", leaseTtlMs: 1000 }),
      ).toMatchObject({ claimed: true });
    });
    test("concurrent sweeps release once and keep other namespaces isolated", async () => {
      const i = input({ reservationTtlMs: 1 });
      await f.store.reserve(i);
      const other = {
        ...input({ reservationTtlMs: 1 }),
        scope: { ...i.scope, namespace: "other" },
      };
      await f.store.reserve(other);
      f.clock.advance(1);
      const results = await Promise.all([
        f.store.expireReservations({ namespace: "test" }),
        f.store.expireReservations({ namespace: "test" }),
      ]);
      expect(results.map((r) => ("count" in r ? r.count : -1)).sort()).toEqual([0, 1]);
      expect(await f.store.getOperation(ref(other))).toMatchObject({ state: "reserved" });
    });
    test("admission sweeps at most one default batch of expired reservations", async () => {
      for (let n = 0; n < 105; n++)
        await f.store.reserve(input({ operationId: `expired-${n}`, reservationTtlMs: 1 }));
      f.clock.advance(1);
      await f.store.reserve(input());
      expect(await f.store.expireReservations({ namespace: "test" })).toEqual({
        outcome: "expired",
        count: 5,
        hasMore: false,
      });
    });
    test("expired intent releases its own hold atomically without sweeping another operation", async () => {
      f.budgets.push(budget({ limit: quantity(2n) }));
      const i = input({ reservationTtlMs: 1 }),
        r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      const other = input({ reservationTtlMs: 1 });
      await f.store.reserve(other);
      f.clock.advance(1);
      expect(
        await f.store.markDispatchIntent({
          ...command(r.operation),
          holder: "h",
          leaseTtlMs: 1000,
        }),
      ).toMatchObject({
        granted: false,
        reason: "reservation_expired",
        operation: { state: "released", version: 2 },
      });
      expect(await f.store.getOperation(ref(other))).toMatchObject({ state: "reserved" });
      expect(
        await f.store.applicableBudgets({
          scope: i.scope,
          surface: i.surface,
          units: ["requests"],
        }),
      ).toMatchObject([{ reserved: quantity(1n), remaining: quantity(1n) }]);
    });
    test("invalid lifetimes and batch sizes are rejected", async () => {
      for (const ttl of [0, -1, 86400001, 1.5])
        await expect(f.store.reserve(input({ reservationTtlMs: ttl }))).rejects.toThrow(
          "InvalidInput",
        );
      for (const limit of [0, 1001])
        await expect(f.store.expireReservations({ namespace: "test", limit })).rejects.toThrow(
          "InvalidInput",
        );
    });
  });
}
