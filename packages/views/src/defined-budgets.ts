import type { AccessContext, Budget, DefinedBudgetsQuery, Meter } from "@usagekit/core";
import { attempt } from "./amount.js";
import type { Problem, ViewState } from "./amount.js";

/** Definitions contain editable limits, but are not balances or usage statuses. */
export type DefinedBudgetsView = {
  state: ViewState;
  budgets: readonly Budget[];
  problem: Problem | null;
};
export async function loadDefinedBudgetsView(
  meter: Meter,
  access: AccessContext,
  query: DefinedBudgetsQuery,
): Promise<DefinedBudgetsView> {
  const result = await attempt(() => meter.definedBudgets(access, query));
  if (result.outcome === "forbidden") return { state: "forbidden", budgets: [], problem: null };
  if (result.outcome === "unavailable")
    return { state: "unavailable", budgets: [], problem: result.problem };
  if (!Array.isArray(result.value))
    return {
      state: "unavailable",
      budgets: [],
      problem: { kind: "invalid", field: "budgets", reason: "expected budget definitions" },
    };
  return { state: result.value.length ? "ok" : "empty", budgets: result.value, problem: null };
}
