import { Hono } from "hono";
import { runStoreConformance } from "@usagekit/store/conformance";
import { createManualClock, createMemoryStore, InvalidInput } from "@usagekit/store";
import type { Store } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { createUsageHandlers } from "@usagekit/http";
import type { AccessContext, Budget, ReadResult } from "@usagekit/core";
import { createRemoteMeter } from "./index.js";
const access = (namespace: string): AccessContext => ({
  namespace,
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
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
      getOperation: async (i) =>
        readResult(await client(i.namespace).getOperation(access(i.namespace), i)),
      aggregate: async (q) =>
        readResult(await client(q.scope.namespace).usage(access(q.scope.namespace), q)),
      definedBudgets: async (q) =>
        readResult(await client(q.scope.namespace).definedBudgets(access(q.scope.namespace), q)),
      applicableBudgets: async (q) =>
        readResult(await client(q.scope.namespace).applicableBudgets(access(q.scope.namespace), q)),
    };
    return { store, clock, budgets, close: async () => {} };
  },
  { durable: false, rollingWindows: false, maxMoneyUnits: 2n ** 63n - 1n, maxQuantityScale: 18 },
);
