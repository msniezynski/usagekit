import { createManualClock, createMemoryStore, validateBudget } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import type { Budget, AccessContext, Meter } from "@usagekit/core";
import type { BudgetWriter } from "@usagekit/react";

export const access: AccessContext = {
  namespace: "showcase",
  readablePrincipals: ["sample-owner"],
  readableGroups: [],
  readablePools: ["shared-pool"],
  canReadBillingDetail: true,
  canManageBudgets: true,
};
export const scope = { namespace: "showcase", principal: "sample-owner", connection: "search-key" };
export const owner = {
  kind: "principal",
  namespace: "showcase",
  principal: "sample-owner",
} as const;
export const period = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };
export const initialBudget: Budget = {
  id: "monthly-requests",
  version: 1,
  scope: owner,
  surface: "any",
  unit: "requests",
  limit: { value: 1000n, scale: 0, unit: "requests" },
  onExceed: "allow",
  hardLimit: { value: 1500n, scale: 0, unit: "requests" },
  alerts: [{ at: { percent: 80 } }],
  window: { kind: "calendar_month", timezone: "UTC" },
};
export type DemoState = { meter: Meter; writer: BudgetWriter };

/** Local sample data only. This is a host adapter fixture, never a production write endpoint. */
export async function createDemoState(): Promise<DemoState> {
  const clock = createManualClock("2026-10-07T12:00:00.000Z");
  const budgets: Budget[] = [structuredClone(initialBudget)];
  const store = createMemoryStore({ clock, budgets });
  const meter = createMeter({ store, clock });
  for (let index = 0; index < 6; index++) {
    const fundingSource = index < 4 ? "byok" : "platform";
    const reserved = await store.reserve({
      operationId: `sample-${index}`,
      scope,
      fundingSource,
      costOwner: index < 4 ? "sample-owner" : "workspace",
      surface: "app",
      source: "app",
      provider: index < 4 ? "search" : "language",
      operation: "lookup",
      platformPools: fundingSource === "platform" ? ["shared-pool"] : [],
      estimate: [{ value: 100n, scale: 0, unit: "requests" }],
    });
    if (reserved.outcome !== "reserved") throw Error("Sample reservation failed");
    const ref = {
      namespace: "showcase",
      principal: "sample-owner",
      operationId: reserved.operation.operationId,
    };
    const grant = await store.markDispatchIntent({
      ...ref,
      commandId: `intent-${index}`,
      expectedVersion: reserved.operation.version,
      holder: "sample",
      leaseTtlMs: 60000,
    });
    if (!("granted" in grant) || !grant.granted) throw Error("Sample grant failed");
    await store.settle({
      ...ref,
      commandId: `settle-${index}`,
      expectedVersion: grant.operation.version,
      authority: { kind: "lease", leaseId: grant.lease.leaseId },
      receipt: {
        id: `receipt-${index}`,
        measurements: [
          {
            unit: "requests",
            quantity: { value: 100n, scale: 0, unit: "requests" },
            certainty: "measured",
          },
          {
            unit: "tokens",
            quantity: { value: 2500n, scale: 0, unit: "tokens" },
            certainty: "estimated",
          },
          {
            unit: "customer_cents",
            quantity: {
              value: fundingSource === "platform" ? 180000n : 0n,
              scale: 4,
              unit: "customer_cents",
            },
            certainty: "measured",
          },
        ],
        cost: { certainty: "measured", money: { units: 125600n, currency: "USD" } },
        occurredAt: clock.now().toISOString(),
        recordedAt: clock.now().toISOString(),
        cached: false,
        failed: false,
      },
    });
  }
  await store.reserve({
    operationId: "sample-expired",
    scope,
    fundingSource: "byok",
    costOwner: "sample-owner",
    surface: "app",
    source: "app",
    provider: "search",
    operation: "lookup",
    platformPools: [],
    estimate: [{ value: 100n, scale: 0, unit: "requests" }],
    reservationTtlMs: 1000,
  });
  clock.advance(65000);
  const wrapped: Meter = meter;
  // The sample writer performs a synchronous CAS between awaits, using only preselected scope.
  const writer: BudgetWriter = {
    async save(candidate) {
      if (!access.canManageBudgets || JSON.stringify(candidate.scope) !== JSON.stringify(owner))
        return { outcome: "forbidden" };
      const index = budgets.findIndex((row) => row.id === candidate.id);
      const previous = budgets[index];
      if (candidate.version !== (previous?.version ?? 0) + 1)
        return { outcome: "conflict", reason: "Budget changed" };
      if (!previous && !["monthly-tokens"].includes(candidate.id)) return { outcome: "forbidden" };
      try {
        validateBudget(candidate);
      } catch {
        return { outcome: "invalid", field: "limit", reason: "Invalid budget" };
      }
      const saved = structuredClone(candidate);
      if (index < 0) budgets.push(saved);
      else budgets[index] = saved;
      return { outcome: "saved", budget: structuredClone(saved) };
    },
    async reconcile(candidate) {
      const saved = budgets.find((row) => row.id === candidate.id);
      return saved?.version === candidate.version
        ? { outcome: "saved", budget: structuredClone(saved) }
        : { outcome: "not_saved" };
    },
  };
  return { meter: wrapped, writer };
}
