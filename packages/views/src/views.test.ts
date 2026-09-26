import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import type { ManualClock, Store } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { createUsageHandlers } from "@usagekit/http";
import { createRemoteMeter } from "@usagekit/client";
import type {
  AccessContext,
  Budget,
  Meter,
  Operation,
  Receipt,
  ReserveInput,
  UsageQuery,
} from "@usagekit/core";
import {
  createMemoryCoverageSource,
  loadBudgetsView,
  loadCoverageView,
  loadExceptionsView,
  loadHeaderStatus,
  loadUsageView,
} from "./index.js";

const context = (overrides: Partial<AccessContext> = {}): AccessContext => ({
  namespace: "test",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
  ...overrides,
});
const wide = context();
const own = context({
  readablePrincipals: ["u1"],
  readableGroups: [],
  readablePools: [],
  canManageBudgets: false,
});
const stranger = context({ readablePrincipals: ["u2"], readableGroups: [], readablePools: [] });
const tokens = new Map([
  ["wide", wide],
  ["own", own],
  ["stranger", stranger],
]);
const scope = { namespace: "test", principal: "u1", connection: "c1", tags: ["t1"] };
const month = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };
const broken = new Proxy({} as Meter, {
  get: () => async () => {
    throw new Error("meter down");
  },
});

type Fixture = {
  clock: ManualClock;
  budgets: Budget[];
  store: Store;
  meter(access: AccessContext): Meter;
};

function setup(kind: "embedded" | "remote"): Fixture {
  const clock = createManualClock(),
    budgets: Budget[] = [],
    store = createMemoryStore({ clock, budgets }),
    embedded = createMeter({
      store,
      clock,
      resolveOwnership: async (s) =>
        s.kind === "connection" && s.connection === "c1"
          ? { kind: "principal", namespace: "test", principal: "u1" }
          : null,
    });
  if (kind === "embedded") return { clock, budgets, store, meter: () => embedded };
  const handler = createUsageHandlers({
      meter: embedded,
      commands: false,
      authenticate: async (r) =>
        tokens.get((r.headers.get("Authorization") ?? "").replace("Bearer ", "")) ?? null,
    }),
    app = new Hono();
  app.all("*", (c) => handler(c.req.raw));
  return {
    clock,
    budgets,
    store,
    meter: (access) =>
      createRemoteMeter({
        baseUrl: "http://local.test",
        token: [...tokens].find(([, a]) => a === access)![0],
        fetch: async (i, init) => app.request(i, init),
      }),
  };
}

const receipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: crypto.randomUUID(),
  measurements: [
    {
      unit: "requests",
      quantity: { value: 1n, scale: 0, unit: "requests" },
      certainty: "measured",
    },
  ],
  cost: { certainty: "measured", money: { units: 12345n, currency: "USD" } },
  occurredAt: "2026-09-23T12:00:00.000Z",
  recordedAt: "2026-09-23T12:00:00.000Z",
  cached: false,
  failed: false,
  ...overrides,
});
const reserveInput = (overrides: Partial<ReserveInput> = {}): ReserveInput => ({
  operationId: crypto.randomUUID(),
  scope,
  fundingSource: "byok",
  costOwner: "u1",
  surface: "app",
  source: "app",
  provider: "search",
  operation: "search",
  estimate: [{ value: 1n, scale: 0, unit: "requests" }],
  ...overrides,
});
async function reserve(f: Fixture, overrides: Partial<ReserveInput> = {}): Promise<Operation> {
  const r = await f.store.reserve(reserveInput(overrides));
  if (r.outcome !== "reserved") throw new Error(`fixture: ${r.outcome}`);
  return r.operation;
}
async function dispatch(f: Fixture, overrides: Partial<ReserveInput> = {}, leaseTtlMs = 60000) {
  const op = await reserve(f, overrides);
  const g = await f.store.markDispatchIntent({
    namespace: "test",
    principal: op.scope.principal,
    operationId: op.operationId,
    commandId: crypto.randomUUID(),
    expectedVersion: op.version,
    holder: "h",
    leaseTtlMs,
  });
  if (!("granted" in g) || !g.granted) throw new Error("fixture");
  return g;
}
async function settle(f: Fixture, r: Receipt = receipt(), overrides: Partial<ReserveInput> = {}) {
  const g = await dispatch(f, overrides);
  const s = await f.store.settle({
    namespace: "test",
    principal: g.operation.scope.principal,
    operationId: g.operation.operationId,
    commandId: crypto.randomUUID(),
    expectedVersion: g.operation.version,
    authority: { kind: "lease", leaseId: g.lease.leaseId },
    receipt: r,
  });
  if (s.outcome !== "settled") throw new Error("fixture");
  return s.operation;
}
const usageQuery = (overrides: Partial<UsageQuery> = {}): UsageQuery => ({
  scope: { kind: "principal", namespace: "test", principal: "u1" },
  ...month,
  units: ["requests", "tokens"],
  groupBy: ["provider"],
  ...overrides,
});
const budget = (overrides: Partial<Budget> = {}): Budget => ({
  id: crypto.randomUUID(),
  version: 1,
  scope: { kind: "principal", namespace: "test", principal: "u1" },
  surface: "any",
  unit: "requests",
  limit: { value: 10n, scale: 0, unit: "requests" },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
  ...overrides,
});
const budgetInput = { scope, surface: "app" as const, units: ["requests"], platformPools: ["p1"] };

describe.each(["embedded", "remote"] as const)("%s meter", (kind) => {
  describe("usage view", () => {
    test("ok rows carry exact text per requested unit, cost and certainty", async () => {
      const f = setup(kind);
      await settle(f, receipt(), { provider: "alpha" });
      await settle(
        f,
        receipt({
          measurements: [
            {
              unit: "requests",
              quantity: { value: 15n, scale: 1, unit: "requests" },
              certainty: "estimated",
            },
          ],
          cost: { certainty: "unknown", money: null },
        }),
        { provider: "beta" },
      );
      const view = await loadUsageView(f.meter(wide), wide, usageQuery());
      expect(view.state).toBe("ok");
      expect(view.units).toEqual(["requests", "tokens"]);
      expect(view.groupBy).toEqual(["provider"]);
      expect(view.asOf).toBe("2026-09-23T12:00:00.000Z");
      expect(view.watermark).toEqual(expect.any(String));
      expect(view.nextCursor).toBeNull();
      expect(view.problem).toBeNull();
      const [alpha, beta] = view.rows;
      expect(alpha).toMatchObject({
        dimensions: { provider: "alpha" },
        units: {
          requests: { text: "1", unit: "requests", certainty: "measured" },
          tokens: "unavailable",
        },
        cost: { text: "1.2345", unit: "cents", certainty: "measured" },
        certainty: "measured",
        fundingSource: "byok",
        costOwner: "u1",
        unknownOperations: "0",
      });
      expect(beta).toMatchObject({
        units: { requests: { text: "1.5", unit: "requests", certainty: "estimated" } },
        cost: { text: "", unit: "cents", certainty: "unknown" },
        certainty: "unknown",
        unknownOperations: "1",
      });
      expect(alpha!.key).not.toBe(beta!.key);
      const page = await loadUsageView(f.meter(wide), wide, usageQuery({ limit: 1 }));
      expect(page.rows).toHaveLength(1);
      expect(page.nextCursor).toEqual(expect.any(String));
      const next = await loadUsageView(
        f.meter(wide),
        wide,
        usageQuery({ limit: 1, cursor: page.nextCursor! }),
      );
      expect(next.rows[0]!.dimensions).toEqual({ provider: "beta" });
    });
    test("empty, forbidden, invalid and unavailable are distinct states", async () => {
      const f = setup(kind);
      const empty = await loadUsageView(f.meter(wide), wide, usageQuery());
      expect(empty).toMatchObject({ state: "empty", rows: [], problem: null });
      expect(empty.asOf).toEqual(expect.any(String));
      const forbidden = await loadUsageView(
        f.meter(own),
        own,
        usageQuery({ scope: { kind: "namespace", namespace: "test" } }),
      );
      expect(forbidden).toMatchObject({ state: "forbidden", rows: [], asOf: null });
      const invalid = await loadUsageView(
        f.meter(wide),
        wide,
        usageQuery({ from: month.to, to: month.from }),
      );
      expect(invalid.state).toBe("unavailable");
      expect(invalid.problem).toMatchObject({ kind: "invalid" });
      const down = await loadUsageView(broken, wide, usageQuery());
      expect(down).toMatchObject({
        state: "unavailable",
        rows: [],
        problem: { kind: "error", message: "meter down" },
      });
    });
  });

  describe("budgets view", () => {
    test("rows carry limits, figures, boundary, alerts and reset time", async () => {
      const f = setup(kind);
      const cap = budget({ id: "cap", alerts: [{ at: { percent: 50 } }, { at: { percent: 90 } }] });
      const soft = budget({
        id: "soft",
        scope: { kind: "connection", namespace: "test", connection: "c1" },
        surface: "app",
        onExceed: "allow",
        limit: { value: 20n, scale: 0, unit: "requests" },
        hardLimit: { value: 30n, scale: 0, unit: "requests" },
        alerts: [{ at: { value: 25n, scale: 0, unit: "requests" } }],
      });
      const open = budget({ id: "open", surface: "cli", limit: null });
      f.budgets.push(cap, soft, open);
      for (let n = 0; n < 5; n++) await settle(f);
      await reserve(f);
      const view = await loadBudgetsView(f.meter(wide), wide, {
        ...budgetInput,
        source: "app",
      });
      expect(view.state).toBe("ok");
      const byId = new Map(view.rows.map((r) => [r.id, r]));
      expect(byId.get("cap")).toMatchObject({
        kind: "principal",
        target: "u1",
        traffic: { kind: "any" },
        window: "calendar_month",
        limit: { text: "10", unit: "requests" },
        used: { text: "5", unit: "requests" },
        reserved: { text: "1", unit: "requests", certainty: "estimated" },
        remaining: { text: "4", unit: "requests" },
        boundary: { onExceed: "block" },
        alerts: [
          { at: { percent: 50 }, crossed: true },
          { at: { percent: 90 }, crossed: false },
        ],
        resetsAt: "2026-10-01T00:00:00.000Z",
        redacted: false,
        level: "warning",
      });
      expect(byId.get("soft")).toMatchObject({
        kind: "connection",
        target: "c1",
        traffic: { kind: "surface", surface: "app" },
        boundary: { onExceed: "allow", hardLimit: { text: "30", unit: "requests" } },
        alerts: [{ at: { text: "25", unit: "requests" }, crossed: false }],
        level: "ok",
      });
      expect(byId.has("open")).toBe(false);
      const cli = await loadBudgetsView(f.meter(wide), wide, {
        ...budgetInput,
        surface: "programmatic",
        source: "cli",
      });
      expect(cli.rows.find((r) => r.id === "open")).toMatchObject({
        traffic: { kind: "source", source: "cli" },
        limit: "unlimited",
        remaining: "unlimited",
        level: "ok",
      });
    });
    test("caller crossings mark alerts crossed before the figures show them", async () => {
      const f = setup(kind);
      const cap = budget({ id: "cap", alerts: [{ at: { percent: 50 } }, { at: { percent: 90 } }] });
      f.budgets.push(cap);
      const view = await loadBudgetsView(f.meter(wide), wide, {
        ...budgetInput,
        crossings: [
          {
            budgetId: "cap",
            budgetVersion: 1,
            epoch: "2026-09",
            at: { percent: 90 },
            used: { value: 9n, scale: 0, unit: "requests" },
            reserved: { value: 0n, scale: 0, unit: "requests" },
          },
          {
            budgetId: "other",
            budgetVersion: 1,
            epoch: "2026-09",
            at: { percent: 50 },
            used: { value: 9n, scale: 0, unit: "requests" },
            reserved: { value: 0n, scale: 0, unit: "requests" },
          },
        ],
      });
      expect(view.rows[0]!.epoch).toBe("2026-09");
      expect(view.rows[0]!.alerts).toEqual([
        { key: "percent:50", at: { percent: 50 }, crossed: false },
        { key: "percent:90", at: { percent: 90 }, crossed: true },
      ]);
      expect(view.rows[0]!.level).toBe("warning");
    });
    test("unreadable pools and tags are redacted, not zero", async () => {
      const f = setup(kind);
      f.budgets.push(
        budget({ id: "pool", scope: { kind: "platform_pool", namespace: "test", poolId: "p1" } }),
        budget({
          id: "tag",
          scope: { kind: "tag", namespace: "test", tag: "t1" },
          alerts: [{ at: { value: 5n, scale: 0, unit: "requests" } }],
        }),
      );
      await settle(f, receipt(), { platformPools: ["p1"] });
      const view = await loadBudgetsView(f.meter(own), own, budgetInput);
      expect(view.state).toBe("ok");
      for (const row of view.rows)
        expect(row).toMatchObject({
          redacted: true,
          limit: "unavailable",
          used: "unavailable",
          reserved: "unavailable",
          remaining: "unavailable",
          alerts: [],
          level: "unavailable",
        });
      expect(view.rows.map((r) => r.target).sort()).toEqual(["p1", "t1"]);
      const visible = await loadBudgetsView(f.meter(wide), wide, budgetInput);
      expect(visible.rows.every((r) => !r.redacted)).toBe(true);
    });
    test("empty, forbidden and unavailable", async () => {
      const f = setup(kind);
      expect(await loadBudgetsView(f.meter(wide), wide, budgetInput)).toMatchObject({
        state: "empty",
        rows: [],
      });
      expect(await loadBudgetsView(f.meter(stranger), stranger, budgetInput)).toMatchObject({
        state: "forbidden",
        rows: [],
      });
      expect(await loadBudgetsView(broken, wide, budgetInput)).toMatchObject({
        state: "unavailable",
        problem: { kind: "error" },
      });
    });
  });

  describe("header status", () => {
    test("one bound per visible limit, redacted bounds counted as hidden", async () => {
      const f = setup(kind);
      f.budgets.push(
        budget({ id: "cap" }),
        budget({ id: "pool", scope: { kind: "platform_pool", namespace: "test", poolId: "p1" } }),
        budget({ id: "open", limit: null }),
      );
      for (let n = 0; n < 8; n++) await settle(f, receipt(), { platformPools: ["p1"] });
      const status = await loadHeaderStatus(f.meter(own), own, budgetInput);
      expect(status).toMatchObject({
        state: "ok",
        level: "warning",
        hidden: 1,
        bounds: [
          {
            budgetId: "cap",
            kind: "principal",
            target: "u1",
            unit: "requests",
            remaining: { text: "2", unit: "requests" },
            of: { text: "10", unit: "requests" },
            resetsAt: "2026-10-01T00:00:00.000Z",
            level: "warning",
            warningAt: { percent: 80 },
          },
        ],
      });
      const all = await loadHeaderStatus(f.meter(wide), wide, budgetInput);
      expect(all.bounds.map((b) => b.budgetId).sort()).toEqual(["cap", "pool"]);
      expect(all.hidden).toBe(0);
    });
    test("crossings from the last command raise the level in the same request", async () => {
      const f = setup(kind);
      f.budgets.push(budget({ id: "cap", alerts: [{ at: { percent: 30 } }] }));
      const crossing = {
        budgetId: "cap",
        budgetVersion: 1,
        epoch: "2026-09",
        at: { percent: 30 },
        used: { value: 3n, scale: 0, unit: "requests" },
        reserved: { value: 0n, scale: 0, unit: "requests" },
      };
      const before = await loadHeaderStatus(f.meter(wide), wide, budgetInput);
      expect(before.level).toBe("ok");
      const after = await loadHeaderStatus(f.meter(wide), wide, {
        ...budgetInput,
        crossings: [crossing],
      });
      expect(after.bounds[0]).toMatchObject({ level: "warning", warningAt: { percent: 30 } });
    });
    test("empty, forbidden and unavailable", async () => {
      const f = setup(kind);
      expect(await loadHeaderStatus(f.meter(wide), wide, budgetInput)).toMatchObject({
        state: "empty",
        level: "ok",
        bounds: [],
      });
      expect(await loadHeaderStatus(f.meter(stranger), stranger, budgetInput)).toMatchObject({
        state: "forbidden",
      });
      expect(await loadHeaderStatus(broken, wide, budgetInput)).toMatchObject({
        state: "unavailable",
      });
    });
  });

  describe("coverage view", () => {
    const coverageScope = { kind: "principal", namespace: "test", principal: "u1" } as const;
    test("without a source the meter combines usage with persisted request counts", async () => {
      const f = setup(kind);
      for (let n = 0; n < 3; n++) await settle(f);
      const view = await loadCoverageView(f.meter(wide), wide, { scope: coverageScope, ...month });
      expect(view).toMatchObject({
        state: "ok",
        origin: "meter",
        total: "3",
        costExcludesUntracked: false,
      });
      expect(view.entries).toEqual([
        { state: "metered", count: "3", share: "100" },
        { state: "passthrough", count: "0", share: "0" },
        { state: "unpriced", count: "0", share: "0" },
        { state: "cached", count: "0", share: "0" },
        { state: "rate_limited", count: "0", share: "0" },
      ]);
    });
    test("persistent unpriced and passthrough counts reach coverage and honor authorization", async () => {
      const f = setup(kind),
        meter = f.meter(wide);
      await settle(f);
      for (const state of ["passthrough", "unpriced"] as const)
        await f.store.countRequest({
          commandId: state,
          scope: { namespace: "test", principal: "u1", connection: "c1" },
          surface: "programmatic",
          source: "cli",
          provider: "search",
          operation: "query",
          state,
        });
      const view = await loadCoverageView(meter, wide, { scope: coverageScope, ...month });
      expect(view).toMatchObject({
        total: "3",
        costExcludesUntracked: true,
        entries: [
          { state: "metered", count: "1", share: "33.33" },
          { state: "passthrough", count: "1", share: "33.33" },
          { state: "unpriced", count: "1", share: "33.33" },
          { state: "cached", count: "0", share: "0" },
          { state: "rate_limited", count: "0", share: "0" },
        ],
      });
      const denied = { ...meter, requestCounts: async () => ({ outcome: "forbidden" as const }) };
      expect(
        await loadCoverageView(denied, wide, { scope: coverageScope, ...month }),
      ).toMatchObject({ state: "forbidden" });
      const truncated = {
        ...meter,
        requestCounts: async () => ({
          outcome: "ok" as const,
          value: { rows: [], truncated: true, asOf: month.from },
        }),
      };
      expect(
        await loadCoverageView(truncated, wide, { scope: coverageScope, ...month }),
      ).toMatchObject({ state: "unavailable" });
    });
    test("a coverage source supplies every state with exact shares", async () => {
      const f = setup(kind);
      const source = createMemoryCoverageSource();
      source.add({
        namespace: "test",
        principal: "u1",
        state: "metered",
        at: month.from,
        count: 2n,
      });
      source.add({ namespace: "test", principal: "u1", state: "passthrough", at: month.from });
      source.add({ namespace: "test", principal: "u2", state: "unpriced", at: month.from });
      source.add({ namespace: "test", principal: "u1", state: "cached", at: month.to });
      const view = await loadCoverageView(f.meter(wide), wide, {
        scope: coverageScope,
        ...month,
        source,
      });
      expect(view).toMatchObject({
        state: "ok",
        origin: "source",
        total: "3",
        costExcludesUntracked: true,
      });
      expect(view.entries).toEqual([
        { state: "metered", count: "2", share: "66.66" },
        { state: "passthrough", count: "1", share: "33.33" },
        { state: "unpriced", count: "0", share: "0" },
        { state: "cached", count: "0", share: "0" },
        { state: "rate_limited", count: "0", share: "0" },
      ]);
    });
    test("empty, forbidden and unavailable", async () => {
      const f = setup(kind);
      const source = createMemoryCoverageSource();
      expect(
        await loadCoverageView(f.meter(wide), wide, { scope: coverageScope, ...month, source }),
      ).toMatchObject({ state: "empty", total: "0", costExcludesUntracked: false });
      expect(
        await loadCoverageView(f.meter(wide), wide, { scope: coverageScope, ...month }),
      ).toMatchObject({ state: "empty" });
      expect(
        await loadCoverageView(f.meter(own), own, {
          scope: { kind: "namespace", namespace: "test" },
          ...month,
          source,
        }),
      ).toMatchObject({ state: "forbidden", entries: [] });
      const failing = {
        counts: async () => {
          throw new Error("counter down");
        },
      };
      expect(
        await loadCoverageView(f.meter(wide), wide, {
          scope: coverageScope,
          ...month,
          source: failing,
        }),
      ).toMatchObject({
        state: "unavailable",
        problem: { kind: "error", message: "counter down" },
      });
      expect(
        await loadCoverageView(broken, wide, { scope: coverageScope, ...month }),
      ).toMatchObject({ state: "unavailable" });
    });
  });

  describe("exceptions view", () => {
    test("classifies expired reservations, expired leases and pending work with age", async () => {
      const f = setup(kind);
      const expired = await reserve(f, { reservationTtlMs: 1000 });
      const lost = (await dispatch(f, {}, 1000)).operation;
      const pending = await settle(f, receipt({ cost: { certainty: "unknown", money: null } }));
      await settle(f);
      const fresh = await reserve(f);
      const active = (await dispatch(f, {}, 120000)).operation;
      f.clock.advance(61000);
      const view = await loadExceptionsView(f.meter(wide), wide, {
        scope: { kind: "namespace", namespace: "test" },
        ...month,
        limit: 100,
      });
      expect(view.state).toBe("ok");
      expect(view.asOf).toBe("2026-09-23T12:01:01.000Z");
      const byId = (a: { operationId: string }, b: { operationId: string }) =>
        a.operationId.localeCompare(b.operationId);
      expect([...view.rows].sort(byId).map((r) => [r.operationId, r.kind, r.state])).toEqual(
        [
          [expired.operationId, "reservation_expired", "reserved"],
          [lost.operationId, "lease_expired", "dispatch_intended"],
          [pending.operationId, "pending", "pending"],
        ].sort(([a], [b]) => a!.localeCompare(b!)),
      );
      expect(view.rows.find((r) => r.operationId === expired.operationId)).toMatchObject({
        principal: "u1",
        connection: "c1",
        provider: "search",
        operation: "search",
        source: "app",
        since: "2026-09-23T12:00:01.000Z",
        ageSeconds: 60,
        estimate: [{ text: "1", unit: "requests", certainty: "estimated" }],
      });
      expect(view.rows.find((r) => r.operationId === pending.operationId)).toMatchObject({
        since: "2026-09-23T12:00:00.000Z",
        ageSeconds: 61,
      });
      for (const id of [fresh.operationId, active.operationId])
        expect(view.rows.some((r) => r.operationId === id)).toBe(false);
      const paged = await loadExceptionsView(f.meter(wide), wide, {
        scope: { kind: "namespace", namespace: "test" },
        ...month,
        limit: 1,
      });
      expect(paged.nextCursor).toEqual(expect.any(String));
    });
    test("principal scope lists only that principal's exceptions", async () => {
      const f = setup(kind);
      const pending = await settle(f, receipt({ cost: { certainty: "unknown", money: null } }));
      await settle(f, receipt({ cost: { certainty: "unknown", money: null } }), {
        scope: { namespace: "test", principal: "u2", connection: "c2" },
        costOwner: "u2",
      });
      const view = await loadExceptionsView(f.meter(wide), wide, {
        scope: { kind: "principal", namespace: "test", principal: "u1" },
        ...month,
      });
      expect(view.rows.map((r) => [r.operationId, r.kind])).toEqual([
        [pending.operationId, "pending"],
      ]);
    });
    test("empty, forbidden and unavailable", async () => {
      const f = setup(kind);
      await reserve(f);
      const input = { scope: { kind: "namespace", namespace: "test" } as const, ...month };
      expect(await loadExceptionsView(f.meter(wide), wide, input)).toMatchObject({
        state: "empty",
        rows: [],
      });
      expect(await loadExceptionsView(f.meter(own), own, input)).toMatchObject({
        state: "forbidden",
      });
      expect(await loadExceptionsView(broken, wide, input)).toMatchObject({
        state: "unavailable",
      });
    });
  });
});
