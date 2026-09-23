import type { Meter, ReadResult, ValidationFailure } from "@usagekit/core";
import { InvalidInput } from "@usagekit/store";
import type { Store, Clock } from "@usagekit/store";
import { defaultPolicy } from "./policy.js";
import type { MeterPolicy } from "./policy.js";
import { validate, reserveValidation, usageValidation } from "./validation.js";
import { canRead, canReadBudget } from "./access.js";
export function createMeter({
  store,
  policy = defaultPolicy,
  clock,
  resolveOwnership,
}: {
  store: Store;
  policy?: MeterPolicy;
  clock: Clock;
  resolveOwnership?: import("./access.js").OwnershipResolver;
}): Meter {
  if (!Number.isFinite(clock.now().getTime())) throw new Error("InvalidInput: clock");
  if (
    policy.budgetOrder.length !== 5 ||
    new Set(policy.budgetOrder).size !== 5 ||
    policy.budgetOrder.some((k) => !defaultPolicy.budgetOrder.includes(k))
  )
    throw new Error("InvalidInput: budgetOrder");
  async function safely<T>(fn: () => Promise<T>): Promise<T | ValidationFailure> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof InvalidInput)
        return { outcome: "invalid", field: error.field, reason: error.reason };
      if (
        error instanceof Error &&
        /^(InactiveWindow|UnsupportedWindow|InvalidInput):?/.test(error.message)
      )
        return { outcome: "invalid", field: "window", reason: error.message };
      throw error;
    }
  }
  const command = <T>(input: unknown, fn: () => Promise<T>) => {
    const invalid = validate(input);
    return invalid ? Promise.resolve(invalid) : safely(fn);
  };
  const read = async <T>(fn: () => Promise<T>): Promise<ReadResult<T>> =>
    safely(async () => ({ outcome: "ok" as const, value: await fn() }));
  return {
    expireReservations: (i) => command(i, () => store.expireReservations(i)),
    reserve: async (i) => {
      const invalid = reserveValidation(i);
      if (invalid) return invalid;
      return safely(async () => {
        const existing = await store.getOperation({
          namespace: i.scope.namespace,
          principal: i.scope.principal,
          operationId: i.operationId,
        });
        if (existing) return store.reserve(i, { budgetOrder: policy.budgetOrder });
        const statuses = await store.applicableBudgets({
          scope: i.scope,
          surface: i.surface,
          units: i.estimate.map((q) => q.unit),
          ...(i.platformPools ? { platformPools: i.platformPools } : {}),
        });
        const missing = statuses.find((s) => !i.estimate.some((q) => q.unit === s.budget.unit));
        if (missing)
          return {
            outcome: "invalid" as const,
            reason: "missing_estimate_unit" as const,
            unit: missing.budget.unit,
            operation: null,
          };
        return store.reserve(i, { budgetOrder: policy.budgetOrder });
      });
    },
    markDispatchIntent: (i) => command(i, () => store.markDispatchIntent(i)),
    renewLease: (i) => command(i, () => store.renewLease(i)),
    claimForRecovery: (i) => command(i, () => store.claimForRecovery(i)),
    settle: (i) => command(i, () => store.settle(i)),
    correct: (i) => command(i, () => store.correct(i)),
    releaseUndispatched: (i) => command(i, () => store.releaseUndispatched(i)),
    getOperation: async (access, i) => {
      const invalid = validate(i);
      if (invalid) return invalid;
      if (
        !access.canReadBillingDetail ||
        !canRead(access, { kind: "principal", namespace: i.namespace, principal: i.principal })
      )
        return { outcome: "forbidden" };
      return read(() => store.getOperation(i));
    },
    usage: async (access, q) => {
      const invalid = usageValidation(q);
      if (invalid) return invalid;
      if (!access.canReadBillingDetail || !canRead(access, q.scope))
        return { outcome: "forbidden" };
      return read(() => store.aggregate(q));
    },
    definedBudgets: async (access, q) => {
      const invalid = validate(q);
      if (invalid) return invalid;
      if (!(await canReadBudget(resolveOwnership, access, q.scope)))
        return { outcome: "forbidden" };
      return read(() => store.definedBudgets(q));
    },
    applicableBudgets: async (access, q) => {
      const invalid = validate(q);
      if (invalid) return invalid;
      if (
        !canRead(access, {
          kind: "principal",
          namespace: q.scope.namespace,
          principal: q.scope.principal,
        })
      )
        return { outcome: "forbidden" };
      return safely(async () => {
        const rows = await store.applicableBudgets(q);
        for (const status of rows) {
          if (
            status.budget.scope.kind !== "platform_pool" &&
            !(await canReadBudget(resolveOwnership, access, status.budget.scope))
          )
            return { outcome: "forbidden" as const };
        }
        return {
          outcome: "ok" as const,
          value: rows.map((s) =>
            s.budget.scope.kind === "platform_pool" && !canRead(access, s.budget.scope)
              ? {
                  ...s,
                  budget: { ...s.budget, limit: null },
                  used: null,
                  reserved: null,
                  remaining: null,
                  redacted: true as const,
                }
              : s,
          ),
        };
      });
    },
  };
}
