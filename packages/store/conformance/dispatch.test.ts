import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, command, ref } from "./helpers.js";
export function dispatchTests(factory: StoreFactory) {
  describe("dispatch and leases", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const reserved = async () => {
      const r = await f.store.reserve(input());
      if (r.outcome !== "reserved") throw new Error("fixture");
      return r.operation;
    };
    test("first intent, identical and different replay never grant again", async () => {
      const op = await reserved();
      const cmd = { ...command(op), holder: "h1", leaseTtlMs: 1000 };
      const grant = await f.store.markDispatchIntent(cmd);
      expect(grant).toMatchObject({
        granted: true,
        operation: { state: "dispatch_intended", version: 2 },
        lease: { holder: "h1", expiresAt: "2026-09-23T12:00:01.000Z" },
      });
      for (const commandId of [cmd.commandId, crypto.randomUUID()])
        expect(await f.store.markDispatchIntent({ ...cmd, commandId })).toMatchObject({
          granted: false,
          reason: "already_dispatched",
        });
    });
    test("two concurrent intents grant once", async () => {
      const op = await reserved();
      const results = await Promise.all(
        ["a", "b"].map((holder) =>
          f.store.markDispatchIntent({ ...command(op), holder, leaseTtlMs: 1000 }),
        ),
      );
      expect(results.filter((r) => "granted" in r && r.granted)).toHaveLength(1);
    });
    test("version conflict leaves state unchanged; unknown operation is representable", async () => {
      const op = await reserved();
      expect(
        await f.store.markDispatchIntent({
          ...command(op),
          expectedVersion: 0,
          holder: "h",
          leaseTtlMs: 1,
        }),
      ).toMatchObject({ granted: false, reason: "version_conflict" });
      expect(await f.store.getOperation(ref(op))).toEqual(op);
      expect(
        await f.store.markDispatchIntent({
          ...command(op),
          operationId: "missing",
          holder: "h",
          leaseTtlMs: 1,
        }),
      ).toEqual({ granted: false, reason: "not_reserved", operation: null });
    });
    test("renewal retains version/id; foreign, expired and missing fail", async () => {
      const op = await reserved();
      const g = await f.store.markDispatchIntent({ ...command(op), holder: "h", leaseTtlMs: 1000 });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      const renew = { ...ref(op), leaseId: g.lease.leaseId, leaseTtlMs: 2000 };
      f.clock.advance(500);
      expect(await f.store.renewLease(renew)).toMatchObject({
        renewed: true,
        lease: { leaseId: g.lease.leaseId, expiresAt: "2026-09-23T12:00:02.500Z" },
      });
      expect((await f.store.getOperation(ref(op)))?.version).toBe(2);
      expect(await f.store.renewLease({ ...renew, leaseId: "foreign" })).toEqual({
        renewed: false,
        reason: "not_holder",
      });
      f.clock.advance(2000);
      expect(await f.store.renewLease(renew)).toEqual({ renewed: false, reason: "expired" });
      expect(await f.store.getOperation(ref(op))).toMatchObject({
        state: "dispatch_intended",
        lease: { leaseId: g.lease.leaseId },
      });
      expect(await f.store.renewLease({ ...renew, operationId: "missing" })).toEqual({
        renewed: false,
        reason: "not_active",
      });
    });
  });
}
