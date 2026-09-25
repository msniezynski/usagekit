import { beforeEach, afterEach, describe, test, expect } from "vitest";
import type { UsageQuery, Receipt, BudgetScope, ReserveInput } from "@usagekit/core";
import type { StoreFactory, StoreFixture, StoreCapabilities } from "./factory.js";
import { input, command, receipt, unknownReceipt, budget, quantity, ref } from "./helpers.js";
export function readsTests(factory: StoreFactory, capabilities: StoreCapabilities) {
  describe("reads and exact bounds", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const query = (overrides: Partial<UsageQuery> = {}): UsageQuery => ({
      scope: { kind: "namespace", namespace: "test" },
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      units: ["requests"],
      groupBy: ["provider"],
      ...overrides,
    });
    const settled = async (
      r: Receipt = receipt(),
      principal = "u1",
      provider = "search",
      overrides: Partial<ReserveInput> = {},
    ) => {
      const result = await f.store.reserve(
        input({
          scope: {
            namespace: "test",
            principal,
            connection: "c1",
            group: "g1",
            accessCredential: { kind: "api_key", id: "k1" },
            tags: ["t1"],
          },
          platformPools: ["p1"],
          provider,
          ...overrides,
        }),
      );
      if (result.outcome !== "reserved") throw new Error("fixture");
      const g = await f.store.markDispatchIntent({
        ...command(result.operation),
        holder: "h",
        leaseTtlMs: 1000,
      });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      return f.store.settle({
        ...command(g.operation),
        authority: { kind: "lease", leaseId: g.lease.leaseId },
        receipt: r,
      });
    };
    test.each([
      "principal",
      "provider",
      "operation",
      "surface",
      "source",
      "connection",
      "day",
      "access_credential",
      "platform_pool",
      "funding_source",
      "tag",
    ] as const)("group by %s uses only requested dimensions", async (dim) => {
      await settled();
      const page = await f.store.aggregate(query({ groupBy: [dim] }));
      expect(page.rows).toHaveLength(1);
      expect(Object.keys(page.rows[0]!.dimensions)).toEqual([dim]);
      expect(page.rows[0]!.measurements[0]!.quantity?.value).toBe(1n);
    });
    const cost = (units: bigint): Receipt =>
      receipt({ cost: { certainty: "measured", money: { units, currency: "USD" } } });
    const tagged = (tags: readonly string[] | undefined) => ({
      scope: {
        namespace: "test",
        principal: "u1",
        connection: "c1",
        ...(tags ? { tags } : {}),
      },
    });
    test("funding source totals equal the sum of their operations", async () => {
      await settled(cost(1n));
      await settled(cost(2n));
      await settled(cost(4n), "u1", "search", { fundingSource: "platform", costOwner: "platform" });
      const page = await f.store.aggregate(query({ groupBy: ["funding_source"] }));
      expect(page.rows).toEqual([
        expect.objectContaining({
          dimensions: { funding_source: "byok" },
          fundingSource: "byok",
          cost: { certainty: "measured", money: { units: 3n, currency: "USD" } },
          measurements: [{ unit: "requests", certainty: "measured", quantity: quantity(2n) }],
        }),
        expect.objectContaining({
          dimensions: { funding_source: "platform" },
          fundingSource: "platform",
          cost: { certainty: "measured", money: { units: 4n, currency: "USD" } },
        }),
      ]);
    });
    test("tag rows count a two-tag operation twice, so they are not additive across tags", async () => {
      await settled(cost(3n), "u1", "search", tagged(["a", "b"]));
      await settled(cost(5n), "u1", "search", tagged(undefined));
      const page = await f.store.aggregate(query({ groupBy: ["tag"] }));
      expect(page.rows.map((r) => [r.dimensions.tag, r.cost.money?.units])).toEqual([
        ["", 5n],
        ["a", 3n],
        ["b", 3n],
      ]);
      expect((await f.store.aggregate(query({ groupBy: ["provider"] }))).rows[0]).toMatchObject({
        cost: { money: { units: 8n } },
      });
    });
    test.each(["funding_source", "tag"] as const)(
      "cursor pagination is stable when grouping by %s",
      async (dim) => {
        await settled(cost(1n), "u1", "search", tagged(["a", "b"]));
        await settled(cost(2n), "u1", "search", {
          ...tagged(["c"]),
          fundingSource: "platform",
          costOwner: "platform",
        });
        const all = await f.store.aggregate(query({ groupBy: [dim, "connection"] }));
        const pages = [];
        let cursor: string | undefined;
        do {
          const page = await f.store.aggregate(
            query({ groupBy: [dim, "connection"], limit: 1, ...(cursor ? { cursor } : {}) }),
          );
          pages.push(...page.rows);
          cursor = page.nextCursor;
        } while (cursor);
        expect(pages).toEqual(all.rows);
        expect(pages.length).toBe(dim === "tag" ? 3 : 2);
      },
    );
    test("late receipt groups by occurrence; corrected history is not double-counted", async () => {
      const r = receipt({ occurredAt: "2026-09-02T10:00:00.000Z" });
      const op = await settled(r);
      if (op.outcome !== "settled") throw new Error("fixture");
      await f.store.correct({
        ...command(op.operation),
        authority: { kind: "late_evidence", source: "provider" },
        receipt: receipt({
          occurredAt: r.occurredAt,
          cost: { certainty: "measured", money: { units: 2n, currency: "USD" } },
        }),
        replacesReceiptId: r.id,
        reason: "fix",
      });
      const page = await f.store.aggregate(query({ groupBy: ["day"] }));
      expect(page.rows[0]).toMatchObject({
        dimensions: { day: "2026-09-02" },
        cost: { money: { units: 2n } },
      });
    });
    test("certainty precedence and pending count", async () => {
      await settled();
      await settled(
        receipt({ cost: { certainty: "estimated", money: { units: 2n, currency: "USD" } } }),
      );
      expect((await f.store.aggregate(query())).rows[0]?.cost).toEqual({
        certainty: "estimated",
        money: { units: 3n, currency: "USD" },
      });
      await settled(unknownReceipt());
      expect((await f.store.aggregate(query())).rows[0]).toMatchObject({
        cost: { certainty: "unknown", money: null },
        unknownOperations: 1n,
      });
    });
    test("cursor chain is a frozen version snapshot and bound to its query", async () => {
      await settled(receipt(), "u1", "a");
      await settled(receipt(), "u1", "b");
      const first = await f.store.aggregate(query({ limit: 1 }));
      expect(first.nextCursor).toBeTruthy();
      await settled(receipt(), "u1", "c");
      const second = await f.store.aggregate(query({ limit: 1, cursor: first.nextCursor! }));
      expect(second.watermark).toBe(first.watermark);
      expect(second.nextCursor).toBeUndefined();
      expect([...first.rows, ...second.rows].map((r) => r.dimensions.provider)).toEqual(["a", "b"]);
      expect((await f.store.aggregate(query())).rows).toHaveLength(3);
      await expect(
        f.store.aggregate(
          query({ scope: { kind: "namespace", namespace: "other" }, cursor: first.nextCursor! }),
        ),
      ).rejects.toThrow("InvalidInput");
    });
    test("scope, connection, time and unit filters do not leak", async () => {
      await settled();
      for (const scope of [
        { kind: "principal", namespace: "test", principal: "u2" },
        { kind: "group", namespace: "test", group: "g2" },
        { kind: "platform_pool", namespace: "test", poolId: "p2" },
        { kind: "namespace", namespace: "other" },
      ] as const)
        expect((await f.store.aggregate(query({ scope }))).rows).toHaveLength(0);
      expect((await f.store.aggregate(query({ connection: "other" }))).rows).toHaveLength(0);
      expect((await f.store.aggregate(query({ from: "2026-09-24T00:00:00Z" }))).rows).toHaveLength(
        0,
      );
      expect((await f.store.aggregate(query({ units: ["tokens"] }))).rows[0]?.measurements).toEqual(
        [],
      );
    });
    const scopes: BudgetScope[] = [
      { kind: "principal", namespace: "test", principal: "u1" },
      { kind: "group", namespace: "test", group: "g1" },
      { kind: "connection", namespace: "test", connection: "c1" },
      {
        kind: "access_credential",
        namespace: "test",
        accessCredential: { kind: "api_key", id: "k1" },
      },
      { kind: "platform_pool", namespace: "test", poolId: "p1" },
      { kind: "tag", namespace: "test", tag: "t1" },
    ];
    test.each(scopes)("defined budgets are exact: $kind", async (scope) => {
      const b = budget({ scope });
      f.budgets.push(b, budget({ scope: { ...scope, namespace: "other" } }));
      expect(await f.store.definedBudgets({ scope })).toEqual([b]);
    });
    test("applicable statuses include settled and reserved quantities and unlimited bounds", async () => {
      f.budgets.push(budget({ limit: quantity(5n) }), budget({ limit: null }));
      await settled();
      const i = input();
      await f.store.reserve(i);
      const statuses = await f.store.applicableBudgets({
        scope: i.scope,
        surface: i.surface,
        units: ["requests"],
      });
      expect(statuses[0]).toMatchObject({
        used: quantity(1n),
        reserved: quantity(1n),
        remaining: quantity(3n),
      });
      expect(statuses[1]!.remaining).toBeNull();
    });
    test("storage rejects money above capability on reserve and settle atomically", async () => {
      await expect(
        f.store.reserve(
          input({ estimate: [quantity(capabilities.maxMoneyUnits + 1n, "cents", 4)] }),
        ),
      ).rejects.toThrow("InvalidInput");
      const i = input();
      const r = await f.store.reserve(i);
      if (r.outcome !== "reserved") throw new Error("fixture");
      const g = await f.store.markDispatchIntent({
        ...command(r.operation),
        holder: "h",
        leaseTtlMs: 1000,
      });
      if (!("granted" in g) || !g.granted) throw new Error("fixture");
      await expect(
        f.store.settle({
          ...command(g.operation),
          authority: { kind: "lease", leaseId: g.lease.leaseId },
          receipt: receipt({
            cost: {
              certainty: "measured",
              money: { units: capabilities.maxMoneyUnits + 1n, currency: "USD" },
            },
          }),
        }),
      ).rejects.toThrow("InvalidInput");
      expect(await f.store.getOperation(ref(i))).toEqual(g.operation);
    });
  });
}
