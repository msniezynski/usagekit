import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { CountRequestInput, RequestCountsQuery, UsageScope } from "@usagekit/core";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { budget, input, quantity } from "./helpers.js";

export function counterTests(factory: StoreFactory) {
  describe("request counter", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const count = (overrides: Partial<CountRequestInput> = {}): CountRequestInput => ({
      commandId: crypto.randomUUID(),
      scope: { namespace: "test", principal: "u1", connection: "c1" },
      surface: "programmatic",
      source: "proxy",
      provider: "search",
      operation: "search",
      state: "passthrough",
      ...overrides,
    });
    const month = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
    const principal: UsageScope = { kind: "principal", namespace: "test", principal: "u1" };
    const query = (overrides: Partial<RequestCountsQuery> = {}): RequestCountsQuery => ({
      scope: principal,
      ...month,
      groupBy: [],
      ...overrides,
    });

    test("counted request ids cannot become reservations after a policy change", async () => {
      const i = input();
      await f.store.countRequest(count({ commandId: i.operationId, scope: i.scope }));
      await expect(f.store.reserve(i)).rejects.toThrow("operationId");
      const next = input();
      expect(await f.store.reserve(next)).toMatchObject({ outcome: "reserved" });
      expect(
        await f.store.countRequest(count({ commandId: next.operationId, scope: next.scope })),
      ).toMatchObject({ outcome: "conflict" });
    });

    test("counts each state separately and reads them back", async () => {
      for (const state of [
        "passthrough",
        "passthrough",
        "unpriced",
        "cached",
        "rate_limited",
      ] as const)
        expect(await f.store.countRequest(count({ state }))).toEqual({
          outcome: "counted",
          replayed: false,
        });
      const page = await f.store.requestCounts(query());
      expect(page.rows).toEqual([
        { dimensions: {}, state: "cached", count: 1n },
        { dimensions: {}, state: "passthrough", count: 2n },
        { dimensions: {}, state: "rate_limited", count: 1n },
        { dimensions: {}, state: "unpriced", count: 1n },
      ]);
      expect(page.truncated).toBe(false);
      expect(page.asOf).toBe(f.clock.now().toISOString());
    });

    test("an identical replay counts once; a changed payload under the same command conflicts", async () => {
      const c = count();
      await f.store.countRequest(c);
      expect(await f.store.countRequest(c)).toEqual({ outcome: "counted", replayed: true });
      expect(await f.store.countRequest({ ...c, state: "cached" })).toEqual({
        outcome: "conflict",
        reason: "command_mismatch",
      });
      expect((await f.store.requestCounts(query())).rows).toEqual([
        { dimensions: {}, state: "passthrough", count: 1n },
      ]);
    });

    test("the window is [from, to) at store time", async () => {
      f.clock.set("2026-09-30T23:59:59.999Z");
      await f.store.countRequest(count());
      f.clock.set("2026-10-01T00:00:00.000Z");
      await f.store.countRequest(count());
      expect((await f.store.requestCounts(query())).rows).toEqual([
        { dimensions: {}, state: "passthrough", count: 1n },
      ]);
      expect(
        (
          await f.store.requestCounts(
            query({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" }),
          )
        ).rows,
      ).toEqual([{ dimensions: {}, state: "passthrough", count: 1n }]);
    });

    test("scopes select principal, group, namespace and pool; connection filters", async () => {
      await f.store.countRequest(count());
      await f.store.countRequest(
        count({
          scope: { namespace: "test", principal: "u2", group: "g1", connection: "c2" },
          platformPools: ["pool_a"],
        }),
      );
      await f.store.countRequest(
        count({ scope: { namespace: "other", principal: "u1", connection: "c1" } }),
      );
      const total = async (q: Partial<RequestCountsQuery>) =>
        (await f.store.requestCounts(query(q))).rows.reduce((a, r) => a + r.count, 0n);
      expect(await total({})).toBe(1n);
      expect(await total({ scope: { kind: "group", namespace: "test", group: "g1" } })).toBe(1n);
      expect(await total({ scope: { kind: "namespace", namespace: "test" } })).toBe(2n);
      expect(
        await total({ scope: { kind: "namespace", namespace: "test" }, connection: "c2" }),
      ).toBe(1n);
      expect(
        await total({ scope: { kind: "platform_pool", namespace: "test", poolId: "pool_a" } }),
      ).toBe(1n);
      expect(
        await total({ scope: { kind: "platform_pool", namespace: "test", poolId: "pool_b" } }),
      ).toBe(0n);
    });

    test("groupBy provider, operation, connection, source and day", async () => {
      await f.store.countRequest(count({ operation: "a" }));
      await f.store.countRequest(count({ operation: "b", source: "cli" }));
      f.clock.advance(86400000);
      await f.store.countRequest(count({ operation: "a", state: "unpriced" }));
      const rows = (
        await f.store.requestCounts(
          query({ groupBy: ["provider", "operation", "connection", "source", "day"] }),
        )
      ).rows;
      expect(rows).toEqual([
        {
          dimensions: {
            provider: "search",
            operation: "a",
            connection: "c1",
            source: "proxy",
            day: "2026-09-23",
          },
          state: "passthrough",
          count: 1n,
        },
        {
          dimensions: {
            provider: "search",
            operation: "a",
            connection: "c1",
            source: "proxy",
            day: "2026-09-24",
          },
          state: "unpriced",
          count: 1n,
        },
        {
          dimensions: {
            provider: "search",
            operation: "b",
            connection: "c1",
            source: "cli",
            day: "2026-09-23",
          },
          state: "passthrough",
          count: 1n,
        },
      ]);
    });

    test("limit truncates the ordered rows", async () => {
      for (const operation of ["c", "a", "b"]) await f.store.countRequest(count({ operation }));
      const page = await f.store.requestCounts(query({ groupBy: ["operation"], limit: 2 }));
      expect(page.rows.map((r) => r.dimensions.operation)).toEqual(["a", "b"]);
      expect(page.truncated).toBe(true);
    });

    test("counting never reserves or touches budgets", async () => {
      f.budgets.push(budget({ limit: quantity(0n) }));
      expect(await f.store.countRequest(count())).toMatchObject({ outcome: "counted" });
      expect(await f.store.reserve(input())).toMatchObject({ outcome: "exceeded" });
      const statuses = await f.store.applicableBudgets({
        scope: { namespace: "test", principal: "u1", connection: "c1" },
        surface: "app",
        units: ["requests"],
      });
      expect(statuses[0]).toMatchObject({ used: quantity(0n), reserved: quantity(0n) });
    });

    test("an unknown state is a validation failure", async () => {
      await expect(
        f.store.countRequest(count({ state: "metered" as unknown as "passthrough" })),
      ).rejects.toThrow("InvalidInput");
    });
  });
}
