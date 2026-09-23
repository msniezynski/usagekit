import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, command, ref, receipt, unknownReceipt } from "./helpers.js";
export function recoveryTests(factory: StoreFactory) {
  describe("simulated process loss", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const reserve = async () => {
      const r = await f.store.reserve(input());
      if (r.outcome !== "reserved") throw new Error("fixture");
      return r.operation;
    };
    const grant = async () => {
      const op = await reserve();
      const g = await f.store.markDispatchIntent({
        ...command(op),
        holder: "old",
        leaseTtlMs: 1000,
      });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      return g;
    };
    test("lost holder cannot regain dispatch; recovery fences old settlement", async () => {
      const g = await grant();
      expect(
        await f.store.markDispatchIntent({
          ...command(g.operation),
          holder: "new",
          leaseTtlMs: 1000,
        }),
      ).toMatchObject({ granted: false, reason: "already_dispatched" });
      f.clock.advance(1000);
      const r = await f.store.claimForRecovery({
        ...ref(g.operation),
        holder: "new",
        leaseTtlMs: 1000,
      });
      expect(r).toMatchObject({ claimed: true, lease: { holder: "new" } });
      if (!("claimed" in r) || !r.claimed) throw new Error("fixture");
      expect(r.lease.leaseId).not.toBe(g.lease.leaseId);
      expect(
        await f.store.settle({
          ...command(r.operation),
          authority: { kind: "lease", leaseId: g.lease.leaseId },
          receipt: receipt(),
        }),
      ).toMatchObject({ reason: "not_holder" });
      expect(
        await f.store.settle({
          ...command(r.operation),
          authority: { kind: "recovery", leaseId: r.lease.leaseId },
          receipt: receipt(),
        }),
      ).toMatchObject({ outcome: "settled", operation: { state: "settled" } });
    });
    test("active lease, reserved, released, settled and missing claims fail", async () => {
      const g = await grant();
      const claim = { ...ref(g.operation), holder: "new", leaseTtlMs: 1000 };
      expect(await f.store.claimForRecovery(claim)).toMatchObject({ reason: "lease_active" });
      expect(await f.store.claimForRecovery({ ...claim, operationId: "missing" })).toEqual({
        claimed: false,
        reason: "not_found",
        operation: null,
      });
      const reserved = await reserve();
      expect(await f.store.claimForRecovery({ ...claim, ...ref(reserved) })).toMatchObject({
        reason: "not_recoverable",
      });
      await f.store.releaseUndispatched({ ...command(reserved), reason: "cancel" });
      expect(await f.store.claimForRecovery({ ...claim, ...ref(reserved) })).toMatchObject({
        reason: "not_recoverable",
      });
      await f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: receipt(),
      });
      expect(await f.store.claimForRecovery(claim)).toMatchObject({ reason: "not_recoverable" });
    });
    test("concurrent recovery claims and a second expired recovery lease", async () => {
      const g = await grant();
      f.clock.advance(1000);
      const claims = await Promise.all(
        ["a", "b"].map((holder) =>
          f.store.claimForRecovery({ ...ref(g.operation), holder, leaseTtlMs: 1000 }),
        ),
      );
      expect(claims.filter((c) => "claimed" in c && c.claimed)).toHaveLength(1);
      const first = claims.find((c) => "claimed" in c && c.claimed)!;
      if (!("claimed" in first) || !first.claimed) throw new Error("fixture");
      f.clock.advance(1000);
      const second = await f.store.claimForRecovery({
        ...ref(g.operation),
        holder: "c",
        leaseTtlMs: 1000,
      });
      if (!("claimed" in second) || !second.claimed) throw new Error("fixture");
      expect(second.lease.leaseId).not.toBe(first.lease.leaseId);
      expect(
        await f.store.settle({
          ...command(second.operation),
          authority: { kind: "recovery", leaseId: first.lease.leaseId },
          receipt: receipt(),
        }),
      ).toMatchObject({ reason: "not_holder" });
    });
    test("pending claim corrects uncertain receipt", async () => {
      const g = await grant();
      const r = unknownReceipt();
      await f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: r,
      });
      const claim = await f.store.claimForRecovery({
        ...ref(g.operation),
        holder: "recovery",
        leaseTtlMs: 1000,
      });
      if (!("claimed" in claim) || !claim.claimed) throw new Error("fixture");
      expect(
        await f.store.correct({
          ...command(claim.operation),
          authority: { kind: "recovery", leaseId: claim.lease.leaseId },
          receipt: receipt(),
          replacesReceiptId: r.id,
          reason: "provider evidence",
        }),
      ).toMatchObject({ outcome: "settled", operation: { state: "settled" } });
    });
  });
}
