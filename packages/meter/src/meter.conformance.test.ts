import type { AccessContext, Budget } from "@usagekit/core";
import { createMemoryStore, createManualClock, InvalidInput } from "@usagekit/store";
import type { Store } from "@usagekit/store";
import { runStoreConformance } from "@usagekit/store/conformance";
import { createMeter } from "./meter.js";
const access = (namespace: string): AccessContext => ({
  namespace,
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
});
// The Store contract throws for malformed values. Meter returns ValidationFailure.
// Adapt only that boundary; expected command rejections remain unchanged.
function commandResult<T>(r: T): T {
  if (r && typeof r === "object" && "outcome" in r && r.outcome === "invalid" && "field" in r)
    throw new InvalidInput(String(r.field));
  return r;
}
function readResult<T>(
  r:
    | { outcome: "ok"; value: T }
    | { outcome: "forbidden" }
    | { outcome: "invalid"; field: string; reason: string },
): T {
  if (r.outcome === "ok") return r.value;
  if (r.outcome === "invalid") throw new InvalidInput(r.field);
  throw new Error("Forbidden");
}
runStoreConformance(
  async () => {
    const clock = createManualClock(),
      budgets: Budget[] = [];
    const raw = createMemoryStore({ clock, budgets });
    const meter = createMeter({
      store: raw,
      clock,
      resolveOwnership: async (scope) => {
        if (scope.namespace !== "test") return null;
        if (
          (scope.kind === "connection" && scope.connection === "c1") ||
          (scope.kind === "access_credential" &&
            scope.accessCredential.kind === "api_key" &&
            scope.accessCredential.id === "k1")
        )
          return { kind: "principal", namespace: "test", principal: "u1" };
        return null;
      },
    });
    const store: Store = {
      expireReservations: async (i) => commandResult(await meter.expireReservations(i)),
      reserve: async (i) => commandResult(await meter.reserve(i)),
      markDispatchIntent: async (i) => commandResult(await meter.markDispatchIntent(i)),
      renewLease: async (i) => commandResult(await meter.renewLease(i)),
      claimForRecovery: async (i) => commandResult(await meter.claimForRecovery(i)),
      settle: async (i) => commandResult(await meter.settle(i)),
      correct: async (i) => commandResult(await meter.correct(i)),
      releaseUndispatched: async (i) => commandResult(await meter.releaseUndispatched(i)),
      getOperation: async (i) => readResult(await meter.getOperation(access(i.namespace), i)),
      aggregate: async (q) => readResult(await meter.usage(access(q.scope.namespace), q)),
      listOperations: async (q) =>
        readResult(await meter.listOperations(access(q.scope.namespace), q)),
      definedBudgets: async (q) =>
        readResult(await meter.definedBudgets(access(q.scope.namespace), q)),
      applicableBudgets: async (q) =>
        readResult(await meter.applicableBudgets(access(q.scope.namespace), q)),
    };
    return { store, clock, budgets, close: async () => {} };
  },
  { durable: false, rollingWindows: false, maxMoneyUnits: 2n ** 63n - 1n, maxQuantityScale: 18 },
);
