import { Hono } from "hono";
import { expect, test } from "vitest";
import { runStoreConformance } from "@usagekit/store/conformance";
import { createManualClock, createMemoryStore, InvalidInput } from "@usagekit/store";
import type { Store } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { createUsageHandlers } from "@usagekit/http";
import type { AccessContext, Budget, ReadResult } from "@usagekit/core";
import { createRemoteMeter, RemoteHttpError } from "./index.js";
const access = (namespace: string): AccessContext => ({
  namespace,
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
  canImportBilling: true,
});
function commandResult<T>(r: T): T {
  if (r && typeof r === "object" && "outcome" in r && r.outcome === "invalid" && "field" in r)
    throw new InvalidInput(String(r.field));
  return r;
}
function readResult<T>(r: ReadResult<T>): T {
  if (r.outcome === "ok") return r.value;
  if (r.outcome === "invalid") throw new InvalidInput(r.field);
  throw new Error("Forbidden");
}
runStoreConformance(
  async () => {
    const clock = createManualClock(),
      budgets: Budget[] = [],
      raw = createMemoryStore({ clock, budgets }),
      meter = createMeter({
        store: raw,
        clock,
        resolveOwnership: async (scope) =>
          scope.namespace === "test"
            ? { kind: "principal", namespace: "test", principal: "u1" }
            : null,
      });
    const app = new Hono(),
      tokens = new Map([
        ["test-token", access("test")],
        ["other-token", access("other")],
      ]);
    const handler = createUsageHandlers({
      meter,
      authenticate: async (r) =>
        tokens.get((r.headers.get("Authorization") ?? "").replace("Bearer ", "")) ?? null,
    });
    app.all("*", (c) => handler(c.req.raw));
    const clients = new Map(
      ["test", "other"].map((ns) => [
        ns,
        createRemoteMeter({
          baseUrl: "http://local.test",
          token: `${ns}-token`,
          fetch: async (i, init) => app.request(i, init),
        }),
      ]),
    );
    const client = (ns: string) => clients.get(ns)!;
    const store: Store = {
      importBilling: async (i) => {
        const result = commandResult(
          await client(i.scope.namespace).importBilling(access(i.scope.namespace), i),
        );
        if (result.outcome === "forbidden") throw new Error("Forbidden");
        return result;
      },
      billingImports: async (q) =>
        readResult(await client(q.scope.namespace).billingImports(access(q.scope.namespace), q)),
      expireReservations: async (i) =>
        commandResult(await client(i.namespace).expireReservations(i)),
      reserve: async (i) => commandResult(await client(i.scope.namespace).reserve(i)),
      markDispatchIntent: async (i) =>
        commandResult(await client(i.namespace).markDispatchIntent(i)),
      renewLease: async (i) => commandResult(await client(i.namespace).renewLease(i)),
      claimForRecovery: async (i) => commandResult(await client(i.namespace).claimForRecovery(i)),
      settle: async (i) => commandResult(await client(i.namespace).settle(i)),
      correct: async (i) => commandResult(await client(i.namespace).correct(i)),
      releaseUndispatched: async (i) =>
        commandResult(await client(i.namespace).releaseUndispatched(i)),
      countRequest: async (i) => commandResult(await client(i.scope.namespace).countRequest(i)),
      requestCounts: async (q) =>
        readResult(await client(q.scope.namespace).requestCounts(access(q.scope.namespace), q)),
      getOperation: async (i) =>
        readResult(await client(i.namespace).getOperation(access(i.namespace), i)),
      aggregate: async (q) =>
        readResult(await client(q.scope.namespace).usage(access(q.scope.namespace), q)),
      listOperations: async (q) =>
        readResult(await client(q.scope.namespace).listOperations(access(q.scope.namespace), q)),
      definedBudgets: async (q) =>
        readResult(await client(q.scope.namespace).definedBudgets(access(q.scope.namespace), q)),
      applicableBudgets: async (q) =>
        readResult(await client(q.scope.namespace).applicableBudgets(access(q.scope.namespace), q)),
    };
    return { store, clock, budgets, close: async () => {} };
  },
  { durable: false, rollingWindows: false, maxMoneyUnits: 2n ** 63n - 1n, maxQuantityScale: 18 },
);

test("a read-only mount serves reads to the remote Meter and rejects every command with 404", async () => {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: [] }),
    meter = createMeter({ store, clock }),
    handler = createUsageHandlers({
      meter,
      commands: false,
      authenticate: async (r) =>
        r.headers.get("Authorization") === "Bearer test-token" ? access("test") : null,
    }),
    app = new Hono();
  app.all("*", (c) => handler(c.req.raw));
  const remote = createRemoteMeter({
    baseUrl: "http://local.test",
    token: "test-token",
    fetch: async (i, init) => app.request(i, init),
  });
  const reserve = {
    operationId: "op",
    scope: { namespace: "test", principal: "u1", connection: "c1" },
    fundingSource: "byok" as const,
    costOwner: "u1",
    surface: "app" as const,
    source: "app" as const,
    provider: "search",
    operation: "search",
    estimate: [{ value: 1n, scale: 0, unit: "requests" }],
  };
  await store.reserve(reserve);
  const ref = { namespace: "test", principal: "u1", operationId: "op" };
  expect(await remote.getOperation(access("test"), ref)).toMatchObject({
    outcome: "ok",
    value: { operationId: "op" },
  });
  expect(
    await remote.usage(access("test"), {
      scope: { kind: "namespace", namespace: "test" },
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      units: ["requests"],
      groupBy: ["provider"],
    }),
  ).toMatchObject({ outcome: "ok", value: { rows: [] } });
  const listed = await remote.listOperations(access("test"), {
    scope: { kind: "namespace", namespace: "test" },
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-10-01T00:00:00.000Z",
    states: ["reserved"],
  });
  expect(listed).toMatchObject({ outcome: "ok", value: { operations: [{ operationId: "op" }] } });
  if (listed.outcome === "ok") expect(listed.value.operations[0]!.estimate[0]!.value).toBe(1n);
  expect(
    await remote.definedBudgets(access("test"), {
      scope: { kind: "principal", namespace: "test", principal: "u1" },
    }),
  ).toEqual({ outcome: "ok", value: [] });
  expect(
    await remote.applicableBudgets(access("test"), {
      scope: reserve.scope,
      surface: "app",
      units: ["requests"],
    }),
  ).toEqual({ outcome: "ok", value: [] });
  const command = { ...ref, commandId: "c", expectedVersion: 1 };
  const commands: (() => Promise<unknown>)[] = [
    () => remote.expireReservations({ namespace: "test" }),
    () => remote.reserve(reserve),
    () => remote.markDispatchIntent({ ...command, holder: "h", leaseTtlMs: 1000 }),
    () => remote.renewLease({ ...ref, leaseId: "l", leaseTtlMs: 1000 }),
    () => remote.claimForRecovery({ ...ref, holder: "h", leaseTtlMs: 1000 }),
    () =>
      remote.settle({
        ...command,
        authority: { kind: "lease", leaseId: "l" },
        receipt: {
          id: "r",
          measurements: [],
          cost: { certainty: "unknown", money: null },
          occurredAt: "2026-09-23T12:00:00.000Z",
          recordedAt: "2026-09-23T12:00:00.000Z",
          cached: false,
          failed: false,
        },
      }),
    () =>
      remote.correct({
        ...command,
        authority: { kind: "late_evidence", source: "provider" },
        receipt: {
          id: "r2",
          measurements: [],
          cost: { certainty: "unknown", money: null },
          occurredAt: "2026-09-23T12:00:00.000Z",
          recordedAt: "2026-09-23T12:00:00.000Z",
          cached: false,
          failed: false,
        },
        replacesReceiptId: "r",
        reason: "fix",
      }),
    () => remote.releaseUndispatched({ ...command, reason: "cancel" }),
  ];
  for (const run of commands) {
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteHttpError);
    expect((error as RemoteHttpError).status).toBe(404);
  }
  expect((await store.getOperation(ref))?.version).toBe(1);
});
