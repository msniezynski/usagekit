import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { BudgetAlert, Operation } from "@usagekit/core";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, budget, quantity, command, receipt, ref } from "./helpers.js";
export function alertTests(factory: StoreFactory) {
  describe("alert thresholds recorded once per epoch", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const percent = (n: number) => ({ at: { percent: n } });
    const reserved = async (estimate: bigint) => {
      const r = await f.store.reserve(input({ estimate: [quantity(estimate)] }));
      if (r.outcome !== "reserved") throw new Error("fixture");
      return r;
    };
    const settle = async (op: Operation, measured: bigint) => {
      const g = await f.store.markDispatchIntent({ ...command(op), holder: "h", leaseTtlMs: 1000 });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      const c = {
        ...command(g.operation),
        authority: { kind: "lease" as const, leaseId: g.lease.leaseId },
        receipt: receipt({
          measurements: [{ unit: "requests", certainty: "measured", quantity: quantity(measured) }],
        }),
      };
      const s = await f.store.settle(c);
      if (s.outcome !== "settled") throw new Error("fixture");
      return { result: s, replay: () => f.store.settle(c) };
    };
    test("a reserve crossing a threshold reports it once with the projected figures", async () => {
      const b = budget({ limit: quantity(10n), alerts: [percent(80)] });
      f.budgets.push(b);
      const first = await reserved(8n);
      expect(first.alerts).toEqual([
        {
          budgetId: b.id,
          budgetVersion: 1,
          epoch: "2026-09",
          at: { percent: 80 },
          used: quantity(0n),
          reserved: quantity(8n),
        },
      ]);
      expect((await reserved(1n)).alerts).toEqual([]);
      expect(await f.store.reserve(input({ estimate: [quantity(9n)] }))).toMatchObject({
        outcome: "exceeded",
      });
    });
    test("percent and quantity thresholds report in ascending order on one reserve", async () => {
      const b = budget({
        limit: quantity(10n),
        alerts: [percent(50), { at: quantity(7n) }, percent(90)],
      });
      f.budgets.push(b);
      expect((await reserved(8n)).alerts.map((a) => a.at)).toEqual([{ percent: 50 }, quantity(7n)]);
      expect((await reserved(1n)).alerts.map((a) => a.at)).toEqual([{ percent: 90 }]);
    });
    test("a settlement whose measured amount crosses a threshold reports it on settle", async () => {
      const b = budget({ limit: quantity(10n), alerts: [percent(80)] });
      f.budgets.push(b);
      const r = await reserved(5n);
      expect(r.alerts).toEqual([]);
      const { result, replay } = await settle(r.operation, 9n);
      expect(result.alerts).toEqual([
        {
          budgetId: b.id,
          budgetVersion: 1,
          epoch: "2026-09",
          at: { percent: 80 },
          used: quantity(9n),
          reserved: quantity(0n),
        },
      ]);
      expect(await replay()).toEqual({ ...result, replayed: true });
      expect((await reserved(1n)).alerts).toEqual([]);
    });
    test("a settlement below the estimate reports nothing and later reserves may still cross", async () => {
      const b = budget({ limit: quantity(10n), alerts: [percent(50)] });
      f.budgets.push(b);
      const r = await reserved(4n);
      const { result } = await settle(r.operation, 1n);
      expect(result.alerts).toEqual([]);
      expect((await reserved(4n)).alerts).toHaveLength(1);
    });
    test("concurrent reserves crossing one threshold report it exactly once in total", async () => {
      f.budgets.push(budget({ limit: quantity(100n), alerts: [percent(5)] }));
      const results = await Promise.all(
        Array.from({ length: 6 }, () => f.store.reserve(input({ estimate: [quantity(6n)] }))),
      );
      const crossings = results.flatMap((r) => (r.outcome === "reserved" ? r.alerts : []));
      expect(results.every((r) => r.outcome === "reserved")).toBe(true);
      expect(crossings).toHaveLength(1);
    });
    test("a new epoch reports the same threshold again", async () => {
      const b = budget({
        limit: quantity(2n),
        alerts: [percent(50)],
        window: { kind: "since_reset", epoch: "e1", startsAt: "2026-09-01T00:00:00.000Z" },
      });
      f.budgets.push(b);
      expect((await reserved(1n)).alerts).toMatchObject([{ epoch: "e1" }]);
      expect((await reserved(1n)).alerts).toEqual([]);
      b.window = { kind: "since_reset", epoch: "e2", startsAt: f.clock.now().toISOString() };
      expect((await reserved(1n)).alerts).toMatchObject([{ epoch: "e2", at: { percent: 50 } }]);
    });
    test("reserve replay returns the original crossings and records nothing new", async () => {
      const b = budget({ limit: quantity(10n), alerts: [percent(50), percent(80)] });
      f.budgets.push(b);
      const i = input({ estimate: [quantity(6n)] });
      const first = await f.store.reserve(i);
      if (first.outcome !== "reserved") throw new Error("fixture");
      expect(first.alerts.map((a) => a.at)).toEqual([{ percent: 50 }]);
      expect(await f.store.reserve(i)).toEqual({ ...first, replayed: true });
      expect((await reserved(2n)).alerts.map((a) => a.at)).toEqual([{ percent: 80 }]);
      expect(await f.store.reserve(i)).toEqual({ ...first, replayed: true });
    });
    test("a denied reserve records no crossing", async () => {
      const b = budget({ limit: quantity(10n), alerts: [percent(50)] }),
        blocker = budget({ limit: quantity(0n) });
      f.budgets.push(b, blocker);
      expect(await f.store.reserve(input({ estimate: [quantity(6n)] }))).toMatchObject({
        outcome: "exceeded",
        exceeded: { budget: { id: blocker.id } },
      });
      blocker.limit = quantity(100n);
      expect((await reserved(6n)).alerts).toHaveLength(1);
    });
    const invalid: { name: string; alerts: readonly BudgetAlert[]; limit?: null }[] = [
      { name: "more than eight", alerts: Array.from({ length: 9 }, (_, n) => percent(n + 10)) },
      { name: "not ascending", alerts: [percent(80), percent(50)] },
      { name: "equal thresholds", alerts: [percent(50), { at: quantity(5n) }] },
      { name: "percent below one", alerts: [percent(0)] },
      { name: "percent above hundred", alerts: [percent(101)] },
      { name: "fractional percent", alerts: [percent(12.5)] },
      { name: "quantity in another unit", alerts: [{ at: quantity(1n, "tokens") }] },
      { name: "percent without a limit", alerts: [percent(50)], limit: null },
    ];
    test.each(invalid)("invalid alert definition is a validation failure: $name", async (c) => {
      f.budgets.push(budget({ limit: c.limit === null ? null : quantity(10n), alerts: c.alerts }));
      const i = input();
      await expect(f.store.reserve(i)).rejects.toThrow("InvalidInput");
      expect(await f.store.getOperation(ref(i))).toBeNull();
    });
  });
}
