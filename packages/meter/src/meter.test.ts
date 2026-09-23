import { beforeEach, describe, expect, test, vi } from "vitest";
import { createMemoryStore, createManualClock } from "@usagekit/store";
import type { AccessContext, Budget, ReserveInput, UsageQuery } from "@usagekit/core";
import { createMeter } from "./meter.js";
const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["u1"],
  readableGroups: ["g1"],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
const input = (): ReserveInput => ({
  operationId: crypto.randomUUID(),
  scope: { namespace: "test", principal: "u1", connection: "c1" },
  fundingSource: "byok",
  costOwner: "u1",
  surface: "app",
  source: "app",
  provider: "search",
  operation: "search",
  estimate: [{ value: 1n, scale: 0, unit: "requests" }],
});
const query: UsageQuery = {
  scope: { kind: "principal", namespace: "test", principal: "u1" },
  from: "2026-09-01T00:00:00Z",
  to: "2026-10-01T00:00:00Z",
  units: ["requests"],
  groupBy: ["provider"],
};
const b = (scope: Budget["scope"], unit = "requests"): Budget => ({
  id: crypto.randomUUID(),
  version: 1,
  scope,
  unit,
  surface: "any",
  limit: { value: 0n, unit, scale: 0 },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
});
describe("embedded Meter", () => {
  const clock = createManualClock();
  let budgets: Budget[],
    store: ReturnType<typeof createMemoryStore>,
    meter: ReturnType<typeof createMeter>;
  beforeEach(() => {
    budgets = [];
    store = createMemoryStore({ clock, budgets });
    meter = createMeter({
      store,
      clock,
      resolveOwnership: async (scope) => {
        if (scope.namespace !== "test") return null;
        if (scope.kind === "connection" && scope.connection === "c1")
          return { kind: "principal", namespace: "test", principal: "u1" };
        if (
          scope.kind === "access_credential" &&
          scope.accessCredential.kind === "api_key" &&
          scope.accessCredential.id === "k1"
        )
          return { kind: "group", namespace: "test", group: "g1" };
        return null;
      },
    });
  });
  test.each([-1n, 1.5])("invalid quantity becomes typed failure before Store", async (value) => {
    const spy = vi.spyOn(store, "reserve");
    const i = input();
    i.estimate[0]!.value = value as bigint;
    expect(await meter.reserve(i)).toMatchObject({ outcome: "invalid", field: "estimate" });
    expect(spy).not.toHaveBeenCalled();
  });
  test("empty strings, negative scales and duplicate units are invalid", async () => {
    for (const i of [
      { ...input(), provider: "" },
      { ...input(), estimate: [{ value: 1n, unit: "requests", scale: -1 }] },
      { ...input(), estimate: [{ value: 1n, unit: "", scale: 0 }] },
    ])
      expect(await meter.reserve(i)).toMatchObject({ outcome: "invalid" });
  });
  test("read validation rejects reversed time, excess limit and principal grouping", async () => {
    for (const q of [
      { ...query, from: query.to, to: query.from },
      { ...query, limit: 1001 },
      { ...query, groupBy: ["principal"] as const },
    ])
      expect(await meter.usage(access, q)).toMatchObject({ outcome: "invalid" });
  });
  test("missing bounded units rejected before reserve; atomic check still exists", async () => {
    budgets.push(b({ kind: "principal", namespace: "test", principal: "u1" }, "tokens"));
    const spy = vi.spyOn(store, "reserve");
    expect(await meter.reserve(input())).toEqual({
      outcome: "invalid",
      reason: "missing_estimate_unit",
      unit: "tokens",
      operation: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });
  test("forbidden principals/groups/pools/namespaces never call aggregate", async () => {
    const spy = vi.spyOn(store, "aggregate");
    for (const scope of [
      { kind: "principal", namespace: "test", principal: "u2" },
      { kind: "group", namespace: "test", group: "g2" },
      { kind: "platform_pool", namespace: "test", poolId: "p1" },
      { kind: "namespace", namespace: "test" },
      { kind: "principal", namespace: "other", principal: "u1" },
    ] as const)
      expect(await meter.usage(access, { ...query, scope })).toEqual({ outcome: "forbidden" });
    expect(spy).not.toHaveBeenCalled();
  });
  test("ownership resolves even before any operation exists; missing owner fails closed", async () => {
    expect(
      await meter.definedBudgets(access, {
        scope: { kind: "connection", namespace: "test", connection: "c1" },
      }),
    ).toEqual({ outcome: "ok", value: [] });
    expect(
      await meter.definedBudgets(access, {
        scope: {
          kind: "access_credential",
          namespace: "test",
          accessCredential: { kind: "api_key", id: "k1" },
        },
      }),
    ).toEqual({ outcome: "ok", value: [] });
    expect(
      await meter.definedBudgets(access, {
        scope: { kind: "connection", namespace: "test", connection: "unknown" },
      }),
    ).toEqual({ outcome: "forbidden" });
  });
  test("applicable pool figures redacted; direct pool needs permission", async () => {
    budgets.push(b({ kind: "platform_pool", namespace: "test", poolId: "p1" }));
    const q = {
      scope: input().scope,
      surface: "app" as const,
      units: ["requests"],
      platformPools: ["p1"],
    };
    expect(await meter.applicableBudgets(access, q)).toMatchObject({
      outcome: "ok",
      value: [
        { redacted: true, used: null, reserved: null, remaining: null, budget: { limit: null } },
      ],
    });
    expect(await meter.definedBudgets(access, { scope: budgets[0]!.scope })).toEqual({
      outcome: "forbidden",
    });
    expect(
      await meter.definedBudgets(
        { ...access, canManageBudgets: true },
        { scope: budgets[0]!.scope },
      ),
    ).toMatchObject({ outcome: "ok" });
    expect(await meter.applicableBudgets({ ...access, readablePrincipals: [] }, q)).toEqual({
      outcome: "forbidden",
    });
  });
  test("custom policy order reaches atomic admission", async () => {
    const principal = b({ kind: "principal", namespace: "test", principal: "u1" });
    budgets.push(b({ kind: "platform_pool", namespace: "test", poolId: "p1" }), principal);
    meter = createMeter({
      store,
      clock,
      policy: {
        budgetOrder: ["principal", "platform_pool", "group", "connection", "access_credential"],
        requireEstimateForBoundedUnits: true,
      },
    });
    expect(await meter.reserve({ ...input(), platformPools: ["p1"] })).toMatchObject({
      outcome: "exceeded",
      exceeded: { budget: { id: principal.id } },
    });
  });
  test("getOperation requires principal and billing details authorization", async () => {
    const i = input();
    await meter.reserve(i);
    const ref = { namespace: "test", principal: "u1", operationId: i.operationId };
    expect(await meter.getOperation(access, ref)).toMatchObject({ outcome: "ok" });
    expect(await meter.getOperation({ ...access, readablePrincipals: [] }, ref)).toEqual({
      outcome: "forbidden",
    });
    expect(await meter.getOperation({ ...access, canReadBillingDetail: false }, ref)).toEqual({
      outcome: "forbidden",
    });
  });
  test("invalid commands produce typed results", async () => {
    const cmd = {
      namespace: "test",
      principal: "u1",
      operationId: "",
      commandId: "c",
      expectedVersion: 0,
    };
    expect(await meter.markDispatchIntent({ ...cmd, holder: "h", leaseTtlMs: 1 })).toMatchObject({
      outcome: "invalid",
    });
    expect(await meter.renewLease({ ...cmd, leaseId: "lease", leaseTtlMs: -1 })).toMatchObject({
      outcome: "invalid",
    });
    expect(await meter.claimForRecovery({ ...cmd, holder: "h", leaseTtlMs: 1 })).toMatchObject({
      outcome: "invalid",
    });
    expect(await meter.releaseUndispatched({ ...cmd, reason: "cancel" })).toMatchObject({
      outcome: "invalid",
    });
  });
});

test("reserve replay remains valid after budget policy gains a required unit", async () => {
  const clock = createManualClock(),
    budgets: Budget[] = [],
    store = createMemoryStore({ clock, budgets }),
    meter = createMeter({ store, clock });
  const i = input();
  const first = await meter.reserve(i);
  budgets.push(b({ kind: "principal", namespace: "test", principal: "u1" }, "tokens"));
  expect(await meter.reserve(i)).toEqual({ ...first, replayed: true });
});
test("applicable budgets cannot expose a foreign connection via an owned principal", async () => {
  const clock = createManualClock(),
    scope = { kind: "connection" as const, namespace: "test", connection: "foreign" },
    store = createMemoryStore({
      clock,
      budgets: [b(scope)],
    }),
    meter = createMeter({
      store,
      clock,
      resolveOwnership: async () => ({ kind: "principal", namespace: "test", principal: "other" }),
    });
  expect(
    await meter.applicableBudgets(access, {
      scope: { ...input().scope, connection: "foreign" },
      surface: "app",
      units: ["requests"],
    }),
  ).toEqual({ outcome: "forbidden" });
});
test("unsupported windows are typed, infrastructure failures still throw", async () => {
  const clock = createManualClock(),
    budgets: Budget[] = [
      {
        ...b({ kind: "principal", namespace: "test", principal: "u1" }),
        window: { kind: "rolling", days: 1 },
      },
    ],
    store = createMemoryStore({ clock, budgets }),
    meter = createMeter({ store, clock });
  expect(await meter.reserve(input())).toMatchObject({ outcome: "invalid", field: "window" });
  vi.spyOn(store, "aggregate").mockRejectedValue(new Error("storage unavailable"));
  await expect(meter.usage(access, query)).rejects.toThrow("storage unavailable");
});

test("absent ownership resolver fails closed and foreign namespace owners are rejected", async () => {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: [] });
  const q = { scope: { kind: "connection" as const, namespace: "test", connection: "c1" } };
  expect(await createMeter({ store, clock }).definedBudgets(access, q)).toEqual({
    outcome: "forbidden",
  });
  expect(
    await createMeter({
      store,
      clock,
      resolveOwnership: async () => ({ kind: "principal", namespace: "other", principal: "u1" }),
    }).definedBudgets(access, q),
  ).toEqual({ outcome: "forbidden" });
});
