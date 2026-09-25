import type { AccessContext, BudgetAlertCrossed, BudgetScope, Meter } from "@usagekit/core";
import { alertKey, loadBudgetsView } from "./budgets.js";
import type {
  AlertAt,
  BudgetAlertRow,
  BudgetsInput,
  BudgetsView,
  Level,
  Limit,
} from "./budgets.js";
import type { Problem, ViewState } from "./amount.js";

export type HeaderBound = {
  budgetId: string;
  kind: BudgetScope["kind"];
  target: string;
  unit: string;
  remaining: Limit;
  of: Limit;
  epoch: string;
  resetsAt: string | null;
  level: Level;
  warningAt: AlertAt | null;
  alerts: readonly BudgetAlertRow[];
};
export type HeaderStatus = {
  state: ViewState;
  /** Worst level across visible bounds. */
  level: Level;
  bounds: readonly HeaderBound[];
  /** Bounds that apply but whose figures the caller may not see. */
  hidden: number;
  problem: Problem | null;
};
const order: Record<Level, number> = { ok: 0, warning: 1, exceeded: 2 };
const worst = (levels: readonly Level[]): Level =>
  levels.reduce<Level>((a, b) => (order[b] > order[a] ? b : a), "ok");

/** One bound per visible limited budget; redacted bounds count as hidden, unlimited are skipped. */
export function headerStatusFromBudgets(view: BudgetsView): HeaderStatus {
  const bounds: HeaderBound[] = [];
  let hidden = 0;
  for (const r of view.rows) {
    if (r.redacted || r.level === "unavailable") {
      hidden++;
      continue;
    }
    if (r.limit === "unlimited") continue;
    bounds.push({
      budgetId: r.id,
      kind: r.kind,
      target: r.target,
      unit: r.unit,
      remaining: r.remaining,
      of: r.limit,
      epoch: r.epoch,
      resetsAt: r.resetsAt,
      level: r.level,
      warningAt: r.warningAt,
      alerts: r.alerts,
    });
  }
  return {
    state: view.state,
    level: worst(bounds.map((b) => b.level)),
    bounds,
    hidden,
    problem: view.problem,
  };
}

/**
 * Merges crossings returned by the command that just settled, without another read. Levels only
 * rise; remaining figures refresh on the next load.
 */
export function withCrossings(
  status: HeaderStatus,
  crossings: readonly BudgetAlertCrossed[],
): HeaderStatus {
  if (!crossings.length) return status;
  const bounds = status.bounds.map((b) => {
    const keys = new Set(
      crossings
        .filter((c) => c.budgetId === b.budgetId && c.epoch === b.epoch)
        .map((c) => alertKey(c.at)),
    );
    if (!keys.size) return b;
    const alerts = b.alerts.map((a) => (keys.has(a.key) ? { ...a, crossed: true } : a));
    const warningAt = alerts.filter((a) => a.crossed).at(-1)?.at ?? b.warningAt;
    return { ...b, alerts, warningAt, level: worst([b.level, "warning"]) };
  });
  return { ...status, bounds, level: worst(bounds.map((b) => b.level)) };
}

/** The compact header model; pass the last command's crossings to refresh in the same request. */
export async function loadHeaderStatus(
  meter: Meter,
  access: AccessContext,
  input: BudgetsInput,
): Promise<HeaderStatus> {
  return headerStatusFromBudgets(await loadBudgetsView(meter, access, input));
}
