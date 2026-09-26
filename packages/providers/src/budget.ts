import type { BalanceSnapshot, Budget, ProviderPlan, Quantity } from "@usagekit/core";

export type BudgetTarget = {
  namespace: string;
  connection: string;
  probe?: BalanceSnapshot;
  now?: Date;
};

const day = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addMonths = (d: Date, months: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));

/**
 * The connection budget a plan implies. A plan with an allowance becomes a provider_cycle budget
 * in the allowance unit, ending at the probe's reset date (or one month from today). A prepaid
 * plan bounds the probed remaining balance since now. Hard plans block; soft plans allow past the
 * allowance with a proposed hard cap at twice the allowance, because a soft limit without a cap
 * is a known way to get an unwanted bill. The user accepts or edits the proposal.
 */
export function proposePlanBudget(plan: ProviderPlan, target: BudgetTarget): Budget {
  const now = target.now ?? new Date(),
    base = {
      id: `${target.connection}:plan:${plan.id}`,
      version: 1,
      scope: {
        kind: "connection" as const,
        namespace: target.namespace,
        connection: target.connection,
      },
      surface: "any" as const,
    };
  let limit: Quantity | null = null,
    window: Budget["window"];
  if (plan.allowance) {
    limit = { value: plan.allowance.value, scale: 0, unit: plan.allowance.unit };
    const endsAt = target.probe?.resetsAt
        ? new Date(target.probe.resetsAt)
        : addMonths(midnight(now), 1),
      startsAt = addMonths(endsAt, -1);
    window = {
      kind: "provider_cycle",
      cycleId: `${plan.id}:${day(startsAt)}`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
  } else {
    limit = target.probe?.remaining ?? null;
    window = { kind: "since_reset", epoch: `${plan.id}:${day(now)}`, startsAt: now.toISOString() };
  }
  const unit = limit?.unit ?? plan.allowance?.unit ?? "units";
  const soft = plan.allowanceMode === "soft" && limit !== null;
  return {
    ...base,
    unit,
    limit,
    window,
    onExceed: soft ? "allow" : "block",
    ...(soft ? { hardLimit: { ...limit!, value: limit!.value * 2n } } : {}),
    ...(limit ? { alerts: [{ at: { percent: 80 } }] } : {}),
  };
}
