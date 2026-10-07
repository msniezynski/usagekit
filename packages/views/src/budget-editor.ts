import { formatQuantity } from "@usagekit/core";
import type { Budget, BudgetAlert, Quantity } from "@usagekit/core";
import { compare, percentOf } from "./amount.js";

/** A trusted host supplies identity, version, unit and authority scope/window. Version 0 creates 1. */
export type BudgetTemplate = Pick<
  Budget,
  "id" | "version" | "scope" | "surface" | "unit" | "window"
>;
export type BudgetAlertDraft = { kind: "percent" | "quantity"; value: string };
export type BudgetDraft = {
  limit: string;
  unlimited: boolean;
  onExceed: "block" | "allow";
  hardLimit: string;
  alerts: readonly BudgetAlertDraft[];
};
export type BudgetBuildResult =
  | { outcome: "valid"; budget: Budget }
  | { outcome: "invalid"; field: string; reason: string };

export const emptyBudgetDraft = (): BudgetDraft => ({
  limit: "",
  unlimited: false,
  onExceed: "block",
  hardLimit: "",
  alerts: [],
});
export function budgetDraftFromBudget(budget: Budget): BudgetDraft {
  return {
    limit: budget.limit ? formatQuantity(budget.limit) : "",
    unlimited: budget.limit === null,
    onExceed: budget.onExceed,
    hardLimit: budget.hardLimit ? formatQuantity(budget.hardLimit) : "",
    alerts: (budget.alerts ?? []).map(({ at }) =>
      "percent" in at
        ? { kind: "percent", value: String(at.percent) }
        : { kind: "quantity", value: formatQuantity(at) },
    ),
  };
}

function decimal(text: string, unit: string): Quantity | null {
  if (typeof text !== "string" || text.length > 1024) return null;
  const value = text.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const quantity = { unit, scale: fraction.length, value: BigInt(whole! + fraction) };
  // Matches the Store's cents bound using exact arithmetic at the submitted scale.
  if (
    unit === "cents" &&
    quantity.value * 10000n > (2n ** 63n - 1n) * 10n ** BigInt(quantity.scale)
  )
    return null;
  return quantity;
}
const decimalReason = (unit: string) =>
  unit === "cents"
    ? "expected a nonnegative decimal up to 922337203685477.5807 with at most 18 decimal places"
    : "expected a nonnegative decimal with at most 18 places";

/**
 * Pure validation/build only. The host writer owns authorization and optimistic concurrency;
 * no balance reset, delete or scope mutation is implied by a returned next-version budget.
 */
export function buildBudgetFromDraft(base: BudgetTemplate, draft: BudgetDraft): BudgetBuildResult {
  const invalid = (field: string, reason: string): BudgetBuildResult => ({
    outcome: "invalid",
    field,
    reason,
  });
  if (
    !Number.isSafeInteger(base.version) ||
    base.version < 0 ||
    base.version >= Number.MAX_SAFE_INTEGER
  )
    return invalid("version", "expected a current version that can be incremented");
  if (!base.id || !base.unit || !base.scope.namespace)
    return invalid("template", "host identity, namespace and unit are required");
  if (typeof draft.unlimited !== "boolean") return invalid("unlimited", "expected a boolean");
  if (draft.onExceed !== "block" && draft.onExceed !== "allow")
    return invalid("onExceed", "expected block or allow");
  const limit = draft.unlimited ? null : decimal(draft.limit, base.unit);
  if (!draft.unlimited && !limit) return invalid("limit", decimalReason(base.unit));
  if (typeof draft.hardLimit !== "string") return invalid("hardLimit", "expected decimal text");
  let hardLimit: Quantity | undefined;
  if (draft.hardLimit.trim()) {
    const parsed = decimal(draft.hardLimit, base.unit);
    if (!parsed) return invalid("hardLimit", decimalReason(base.unit));
    if (draft.onExceed !== "allow" || !limit || compare(parsed, limit) <= 0)
      return invalid("hardLimit", "requires allow and must exceed a finite limit");
    hardLimit = parsed;
  }
  if (!Array.isArray(draft.alerts) || draft.alerts.length > 8)
    return invalid("alerts", "expected at most eight thresholds");
  const alerts: BudgetAlert[] = [];
  let previous: Quantity | null = null;
  for (const [index, alert] of draft.alerts.entries()) {
    const field = `alerts.${index}.value`;
    let at: BudgetAlert["at"], threshold: Quantity;
    if (alert?.kind === "percent") {
      if (typeof alert.value !== "string" || !/^\d{1,3}$/.test(alert.value.trim()))
        return invalid(field, "percent must be an integer from 1 to 100");
      const percent = Number(alert.value.trim());
      if (percent < 1 || percent > 100 || !limit)
        return invalid(field, "percent requires a finite limit and an integer from 1 to 100");
      at = { percent };
      threshold = percentOf(limit, BigInt(percent));
    } else if (alert?.kind === "quantity") {
      const parsed = decimal(alert.value, base.unit);
      if (!parsed) return invalid(field, decimalReason(base.unit));
      at = parsed;
      threshold = parsed;
    } else return invalid(field, "expected percent or quantity");
    if (previous && compare(threshold, previous) <= 0)
      return invalid(field, "thresholds must ascend without duplicates");
    previous = threshold;
    alerts.push({ at });
  }
  return {
    outcome: "valid",
    budget: {
      id: base.id,
      version: base.version + 1,
      scope: structuredClone(base.scope),
      surface: base.surface,
      unit: base.unit,
      window: structuredClone(base.window),
      limit,
      onExceed: draft.onExceed,
      ...(hardLimit ? { hardLimit } : {}),
      alerts,
    },
  };
}
