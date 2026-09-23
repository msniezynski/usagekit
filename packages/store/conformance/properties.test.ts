import { describe, expect, test } from "vitest";
import fc from "fast-check";
import type { Operation } from "@usagekit/core";
import type { StoreFactory } from "./factory.js";
import { input, command, ref, receipt, unknownReceipt, budget, quantity } from "./helpers.js";
const numRuns =
  (globalThis as { process?: { env?: { CI?: string } } }).process?.env?.CI === "true" ? 1000 : 200;
export function propertyTests(factory: StoreFactory) {
  describe("generated command interleavings", () => {
    test("holders never reacquire dispatch and mutations preserve state invariants", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          fc.array(
            fc.record({
              kind: fc.constantFrom(
                "intent",
                "renew",
                "settle",
                "correct",
                "release",
                "claim",
                "advanceClock",
              ),
              holder: fc.nat(4),
              advance: fc.integer({ min: 1, max: 1500 }),
              stale: fc.boolean(),
              unknown: fc.boolean(),
            }),
            { minLength: 1, maxLength: 70 },
          ),
          async (k, sequence) => {
            const f = await factory();
            try {
              const i = input(),
                r = await f.store.reserve(i);
              if (r.outcome !== "reserved") throw new Error("fixture");
              let grants = 0;
              const leases: string[] = [];
              for (const step of sequence) {
                const before = (await f.store.getOperation(ref(i)))!;
                const cmd = {
                  ...command(before),
                  expectedVersion: step.stale ? 0 : before.version,
                };
                let result: unknown;
                const leaseId = step.stale
                  ? (leases[0] ?? "foreign")
                  : (before.lease?.leaseId ?? "foreign");
                const authority = {
                  kind: (before.lease?.holder.startsWith("recovery") ? "recovery" : "lease") as
                    | "recovery"
                    | "lease",
                  leaseId,
                };
                if (step.kind === "advanceClock") f.clock.advance(step.advance);
                if (step.kind === "intent") {
                  result = await f.store.markDispatchIntent({
                    ...cmd,
                    holder: `h${step.holder % k}`,
                    leaseTtlMs: 1000,
                  });
                  if (
                    result &&
                    typeof result === "object" &&
                    "granted" in result &&
                    result.granted
                  ) {
                    grants++;
                    leases.push(
                      (result as unknown as { lease: { leaseId: string } }).lease.leaseId,
                    );
                  }
                }
                if (step.kind === "renew")
                  result = await f.store.renewLease({ ...ref(i), leaseId, leaseTtlMs: 1000 });
                if (step.kind === "claim") {
                  result = await f.store.claimForRecovery({
                    ...ref(i),
                    holder: `recovery${step.holder % k}`,
                    leaseTtlMs: 1000,
                  });
                  if (result && typeof result === "object" && "claimed" in result && result.claimed)
                    leases.push(
                      (result as unknown as { lease: { leaseId: string } }).lease.leaseId,
                    );
                }
                if (step.kind === "settle") {
                  const c = {
                    ...cmd,
                    authority,
                    receipt: step.unknown ? unknownReceipt() : receipt(),
                  };
                  const settled = await f.store.settle(c);
                  result = settled;
                  if (settled.outcome === "settled")
                    expect(await f.store.settle(c)).toEqual({ ...settled, replayed: true });
                }
                if (step.kind === "correct") {
                  const c = {
                    ...cmd,
                    authority:
                      before.state === "settled"
                        ? { kind: "late_evidence" as const, source: "provider" }
                        : authority,
                    receipt: receipt(),
                    replacesReceiptId: before.receipts.at(-1)?.id ?? "missing",
                    reason: "adjust",
                  };
                  const corrected = await f.store.correct(c);
                  result = corrected;
                  if (corrected.outcome === "settled")
                    expect(await f.store.correct(c)).toEqual({ ...corrected, replayed: true });
                }
                if (step.kind === "release") {
                  const c = { ...cmd, reason: "cancel" };
                  const released = await f.store.releaseUndispatched(c);
                  result = released;
                  if (released.outcome === "released")
                    expect(await f.store.releaseUndispatched(c)).toEqual({
                      ...released,
                      replayed: true,
                    });
                }
                const after = (await f.store.getOperation(ref(i)))!;
                const accepted =
                  result &&
                  typeof result === "object" &&
                  (("granted" in result && result.granted) ||
                    ("claimed" in result && result.claimed) ||
                    ("outcome" in result &&
                      ["settled", "released"].includes(String(result.outcome))));
                expect(grants).toBeLessThanOrEqual(1);
                expect(after.version).toBe(before.version + (accepted ? 1 : 0));
                expect(after.receipts.length).toBeGreaterThanOrEqual(before.receipts.length);
                const allowed: Record<Operation["state"], Operation["state"][]> = {
                  reserved: ["reserved", "dispatch_intended", "released"],
                  dispatch_intended: ["dispatch_intended", "pending", "settled"],
                  pending: ["pending", "settled"],
                  settled: ["settled"],
                  released: ["released"],
                };
                expect(allowed[before.state]).toContain(after.state);
                const live = leases.filter(
                  (id) =>
                    id === after.lease?.leaseId &&
                    Date.parse(after.lease.expiresAt) > f.clock.now().getTime(),
                );
                expect(new Set(live).size).toBeLessThanOrEqual(1);
              }
            } finally {
              await f.close();
            }
          },
        ),
        { numRuns, verbose: 2 },
      );
    });
    test("many operations never over-admit any blocking budget", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              kind: fc.constantFrom("principal", "connection", "platform_pool"),
              limit: fc.integer({ min: 0, max: 30 }),
              warn: fc.boolean(),
            }),
            { minLength: 1, maxLength: 4 },
          ),
          fc.array(
            fc.record({
              owner: fc.integer({ min: 1, max: 3 }),
              amount: fc.integer({ min: 0, max: 5 }),
              settled: fc.boolean(),
            }),
            { minLength: 1, maxLength: 30 },
          ),
          async (bounds, operations) => {
            const f = await factory();
            try {
              for (const spec of bounds)
                f.budgets.push(
                  budget({
                    scope:
                      spec.kind === "principal"
                        ? { kind: "principal", namespace: "test", principal: "u1" }
                        : spec.kind === "connection"
                          ? { kind: "connection", namespace: "test", connection: "c1" }
                          : { kind: "platform_pool", namespace: "test", poolId: "pool" },
                    limit: quantity(BigInt(spec.limit)),
                    onExceed: spec.warn ? "warn" : "block",
                  }),
                );
              const accepted: Operation[] = [];
              for (const spec of operations) {
                const i = input({
                  scope: { namespace: "test", principal: `u${spec.owner}`, connection: "c1" },
                  platformPools: ["pool"],
                  estimate: [quantity(BigInt(spec.amount))],
                });
                const r = await f.store.reserve(i);
                if (r.outcome === "reserved") {
                  accepted.push(r.operation);
                  if (spec.settled) {
                    const g = await f.store.markDispatchIntent({
                      ...command(r.operation),
                      holder: "h",
                      leaseTtlMs: 1000,
                    });
                    if (!("granted" in g) || !g.granted) throw new Error("fixture");
                    await f.store.settle({
                      ...command(g.operation),
                      authority: { kind: "lease", leaseId: g.lease.leaseId },
                      receipt: receipt({
                        measurements: [
                          {
                            unit: "requests",
                            certainty: "measured",
                            quantity: quantity(BigInt(spec.amount)),
                          },
                        ],
                      }),
                    });
                  }
                }
                for (const b of f.budgets.filter((b) => b.onExceed === "block")) {
                  const total = accepted
                    .filter((op) => op.budgetEpochs.some((e) => e.budgetId === b.id))
                    .reduce((n, op) => n + op.estimate[0]!.value, 0n);
                  expect(total).toBeLessThanOrEqual(b.limit!.value);
                }
              }
            } finally {
              await f.close();
            }
          },
        ),
        { numRuns, verbose: 2 },
      );
    });
    test("accepted reserve and release replay without state mutation", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: 100000n }),
          fc.boolean(),
          async (amount, release) => {
            const f = await factory();
            try {
              const i = input({ estimate: [quantity(amount)] });
              const r = await f.store.reserve(i);
              if (r.outcome !== "reserved") throw new Error("fixture");
              expect(await f.store.reserve(i)).toEqual({ ...r, replayed: true });
              if (release) {
                const c = { ...command(r.operation), reason: "cancel" };
                const result = await f.store.releaseUndispatched(c);
                expect(await f.store.releaseUndispatched(c)).toEqual({ ...result, replayed: true });
              }
              const before = await f.store.getOperation(ref(i));
              await f.store.reserve(i);
              expect(await f.store.getOperation(ref(i))).toEqual(before);
            } finally {
              await f.close();
            }
          },
        ),
        { numRuns, verbose: 2 },
      );
    });
  });
}
