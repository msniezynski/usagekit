import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, command, ref, receipt, unknownReceipt, budget, quantity } from "./helpers.js";
export function authorityTests(factory: StoreFactory) {
  describe("settle correct release", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const reserved = async () => {
      const i = input();
      const r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      return r.operation;
    };
    const grant = async () => {
      const op = await reserved();
      const g = await f.store.markDispatchIntent({ ...command(op), holder: "h", leaseTtlMs: 1000 });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      return g;
    };
    test("late evidence requires correction after settlement and still checks version", async () => {
      const g = await grant();
      const original = {
        ...command(g.operation),
        authority: { kind: "lease" as const, leaseId: g.lease.leaseId },
        receipt: receipt(),
      };
      const settled = await f.store.settle(original);
      if (settled.outcome !== "settled") throw new Error("fixture");
      const next = {
        ...command(settled.operation),
        authority: { kind: "late_evidence" as const, source: "provider" },
        receipt: receipt(),
      };
      expect(await f.store.settle(next)).toMatchObject({
        outcome: "rejected",
        reason: "invalid_state",
      });
      expect(await f.store.getOperation(ref(g.operation))).toEqual(settled.operation);
      expect(
        await f.store.correct({
          ...next,
          expectedVersion: 1,
          replacesReceiptId: original.receipt.id,
          reason: "adjustment",
        }),
      ).toMatchObject({ reason: "version_conflict" });
      expect(
        await f.store.correct({
          ...next,
          replacesReceiptId: original.receipt.id,
          reason: "adjustment",
        }),
      ).toMatchObject({
        outcome: "settled",
        operation: {
          receipts: [original.receipt, { ...next.receipt, supersedes: original.receipt.id }],
        },
      });
      expect(await f.store.settle(original)).toEqual({ ...settled, replayed: true });
    });
    test("dispatch command id cannot be reused for settlement", async () => {
      const op = await reserved();
      const c = { ...command(op), holder: "h", leaseTtlMs: 1000 };
      const g = await f.store.markDispatchIntent(c);
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      expect(
        await f.store.settle({
          ...command(g.operation),
          commandId: c.commandId,
          authority: { kind: "lease", leaseId: g.lease.leaseId },
          receipt: receipt(),
        }),
      ).toMatchObject({ outcome: "rejected", reason: "receipt_conflict" });
    });
    test("invalid receipt combinations never mutate accounting", async () => {
      const g = await grant();
      for (const bad of [
        receipt({ cost: { certainty: "measured", money: null } as never }),
        receipt({ cost: { certainty: "unknown", money: { units: 0n, currency: "USD" } } as never }),
        receipt({
          measurements: [
            { unit: "requests", certainty: "measured", quantity: quantity(1n, "other") },
          ],
        }),
      ]) {
        await expect(
          f.store.settle({
            ...command(g.operation),
            authority: { kind: "lease", leaseId: g.lease.leaseId },
            receipt: bad,
          }),
        ).rejects.toThrow("InvalidInput");
        expect(await f.store.getOperation(ref(g.operation))).toEqual(g.operation);
      }
    });
    test("settlement records receipt, clears lease and replay survives version changes", async () => {
      const g = await grant();
      const cmd = {
        ...command(g.operation),
        authority: { kind: "lease" as const, leaseId: g.lease.leaseId },
        receipt: receipt(),
      };
      const result = await f.store.settle(cmd);
      expect(result).toMatchObject({
        outcome: "settled",
        replayed: false,
        operation: { state: "settled", version: 3, lease: null, receipts: [cmd.receipt] },
      });
      expect(await f.store.settle(cmd)).toEqual({ ...result, replayed: true });
      expect(await f.store.settle({ ...cmd, receipt: receipt() })).toMatchObject({
        outcome: "rejected",
        reason: "receipt_conflict",
      });
      expect(
        await f.store.renewLease({
          ...ref(g.operation),
          leaseId: g.lease.leaseId,
          leaseTtlMs: 100,
        }),
      ).toMatchObject({ renewed: false, reason: "not_active" });
    });
    test("foreign, expired, false recovery, stale version and unknown id leave state untouched", async () => {
      const g = await grant();
      const cmd = {
        ...command(g.operation),
        authority: { kind: "lease" as const, leaseId: g.lease.leaseId },
        receipt: receipt(),
      };
      for (const [change, reason] of [
        [{ authority: { kind: "lease", leaseId: "foreign" } }, "not_holder"],
        [{ authority: { kind: "recovery", leaseId: g.lease.leaseId } }, "not_holder"],
        [{ expectedVersion: 1 }, "version_conflict"],
        [{ operationId: "missing" }, "invalid_state"],
      ] as const) {
        expect(await f.store.settle({ ...cmd, ...change })).toMatchObject({
          outcome: "rejected",
          reason,
        });
      }
      f.clock.advance(1000);
      expect(await f.store.settle(cmd)).toMatchObject({ reason: "lease_expired" });
      expect(await f.store.getOperation(ref(g.operation))).toEqual(g.operation);
    });
    test.each([
      unknownReceipt(),
      receipt({ measurements: [{ unit: "requests", certainty: "unknown", quantity: null }] }),
    ])("uncertain evidence keeps exposure and late evidence resolves it", async (r) => {
      f.budgets.push(budget({ limit: quantity(1n) }));
      const g = await grant();
      const result = await f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: r,
      });
      expect(result).toMatchObject({
        outcome: "settled",
        operation: { state: "pending", lease: null },
      });
      expect(await f.store.reserve(input())).toMatchObject({ outcome: "exceeded" });
      if (result.outcome !== "settled") throw new Error("fixture");
      expect(
        await f.store.settle({
          ...command(result.operation),
          authority: { kind: "late_evidence", source: "provider" },
          receipt: receipt(),
        }),
      ).toMatchObject({ outcome: "settled", operation: { state: "settled" } });
    });
    test("late evidence cannot settle reserved or actively dispatched work", async () => {
      const op = await reserved();
      const cmd = {
        ...command(op),
        authority: { kind: "late_evidence" as const, source: "provider" },
        receipt: receipt(),
      };
      expect(await f.store.settle(cmd)).toMatchObject({ reason: "invalid_state" });
      const g = await f.store.markDispatchIntent({ ...command(op), holder: "h", leaseTtlMs: 1000 });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      expect(await f.store.settle({ ...cmd, expectedVersion: g.operation.version })).toMatchObject({
        reason: "invalid_state",
      });
    });
    test.each([false, true])(
      "correction appends history and resolves pending=%s",
      async (unknown) => {
        const g = await grant();
        const r = unknown ? unknownReceipt() : receipt();
        const settled = await f.store.settle({
          ...command(g.operation),
          authority: { kind: "lease", leaseId: g.lease.leaseId },
          receipt: r,
        });
        if (settled.outcome !== "settled") throw new Error("fixture");
        const cmd = {
          ...command(settled.operation),
          authority: { kind: "late_evidence" as const, source: "provider" },
          receipt: receipt(),
          reason: "adjustment",
          replacesReceiptId: r.id,
        };
        expect(await f.store.correct({ ...cmd, replacesReceiptId: "missing" })).toMatchObject({
          reason: "invalid_state",
        });
        const corrected = await f.store.correct(cmd);
        expect(corrected).toMatchObject({
          outcome: "settled",
          operation: {
            state: "settled",
            version: 4,
            receipts: [r, { ...cmd.receipt, supersedes: r.id }],
          },
        });
        expect(await f.store.correct(cmd)).toEqual({ ...corrected, replayed: true });
      },
    );
    test("release reclaims reservation, rejects dispatch/settled and handles replay", async () => {
      f.budgets.push(budget({ limit: quantity(1n) }));
      const op = await reserved();
      const cmd = { ...command(op), reason: "cancel" };
      const r = await f.store.releaseUndispatched(cmd);
      expect(r).toMatchObject({
        outcome: "released",
        operation: { state: "released", version: 2 },
      });
      expect(await f.store.releaseUndispatched(cmd)).toEqual({ ...r, replayed: true });
      expect(
        await f.store.markDispatchIntent({ ...command(op), holder: "h", leaseTtlMs: 1 }),
      ).toMatchObject({ reason: "released" });
      const g = await grant();
      expect(
        await f.store.releaseUndispatched({ ...command(g.operation), reason: "cancel" }),
      ).toMatchObject({ reason: "not_reserved" });
      const settled = await f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: receipt(),
      });
      if (settled.outcome !== "settled") throw new Error("fixture");
      expect(
        await f.store.releaseUndispatched({ ...command(settled.operation), reason: "cancel" }),
      ).toMatchObject({ reason: "not_reserved" });
    });
    test.each([0n, 3n])("settled amount replaces estimate including overruns", async (amount) => {
      f.budgets.push(budget({ limit: quantity(2n) }));
      const g = await grant();
      expect(
        await f.store.settle({
          ...command(g.operation),
          authority: { kind: "lease", leaseId: g.lease.leaseId },
          receipt: receipt({
            measurements: [{ unit: "requests", certainty: "measured", quantity: quantity(amount) }],
          }),
        }),
      ).toMatchObject({ outcome: "settled" });
      expect(await f.store.reserve(input({ estimate: [quantity(2n)] }))).toMatchObject({
        outcome: amount === 0n ? "reserved" : "exceeded",
      });
    });
    test("release version check and unknown op are typed", async () => {
      const op = await reserved();
      expect(
        await f.store.releaseUndispatched({ ...command(op), expectedVersion: 0, reason: "cancel" }),
      ).toMatchObject({ reason: "version_conflict" });
      expect(
        await f.store.releaseUndispatched({
          ...command(op),
          operationId: "missing",
          reason: "cancel",
        }),
      ).toMatchObject({ reason: "not_reserved", operation: null });
    });
    test("reserve replay returns the current settled or released operation", async () => {
      for (const release of [false, true]) {
        const i = input();
        const r = await f.store.reserve(i);
        if (r.outcome !== "reserved") throw new Error("fixture");
        if (release)
          await f.store.releaseUndispatched({ ...command(r.operation), reason: "cancel" });
        else {
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
        }
        expect(await f.store.reserve(i)).toMatchObject({
          outcome: "reserved",
          replayed: true,
          operation: { state: release ? "released" : "settled" },
        });
      }
    });
  });
}
