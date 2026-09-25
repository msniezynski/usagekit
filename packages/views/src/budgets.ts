import { formatQuantity } from "@usagekit/core";
import type {
  AccessContext,
  ApplicableBudgetsQuery,
  Budget,
  BudgetAlert,
  BudgetAlertCrossed,
  BudgetScope,
  BudgetStatus,
  BudgetWindow,
  Meter,
  Quantity,
  Scope,
  Source,
  Surface,
} from "@usagekit/core";
import { attempt, compare, percentOf, plus, quantityAmount } from "./amount.js";
import type { Amount, Figure, Problem, ViewState } from "./amount.js";

export type Level = "ok" | "warning" | "exceeded";
export type Limit = Amount | "unlimited" | "unavailable";
export type AlertAt = { percent: number } | Amount;
export type BudgetAlertRow = { key: string; at: AlertAt; crossed: boolean };
export type BudgetRow = {
  id: string;
  version: number;
  kind: BudgetScope["kind"];
  /** Principal, group, connection, pool or tag id; access credentials read kind:id. */
  target: string;
  traffic:
    | { kind: "any" }
    | { kind: "surface"; surface: Surface }
    | { kind: "source"; source: Source };
  window: BudgetWindow["kind"];
  unit: string;
  limit: Limit;
  used: Figure;
  reserved: Figure;
  remaining: Limit;
  boundary: { onExceed: "block" } | { onExceed: "allow"; hardLimit: Figure | null };
  alerts: readonly BudgetAlertRow[];
  /**
   * Bar geometry as exact percent text of the bar extent (hardLimit or limit, or used plus
   * reserved when larger), truncated to two decimals and capped at 100. Null without a bar.
   */
  bar: BudgetBar | null;
  /** Highest crossed alert, or 80 percent of the limit when no alerts are defined. */
  warningAt: AlertAt | null;
  epoch: string;
  resetsAt: string | null;
  redacted: boolean;
  level: Level | "unavailable";
};
export type BudgetBar = {
  used: string;
  reserved: string;
  limit: string;
  hardLimit: string | null;
  alerts: readonly string[];
};
export type BudgetsView = { state: ViewState; rows: readonly BudgetRow[]; problem: Problem | null };
export type BudgetsInput = {
  scope: Scope;
  surface: Surface;
  units: readonly string[];
  platformPools?: readonly string[];
  source?: Source;
  /** Crossings returned by the last reserve, settle or correct of this request. */
  crossings?: readonly BudgetAlertCrossed[];
};

/** Scale-invariant identity of a threshold, shared by rows and crossings. */
export const alertKey = (at: BudgetAlert["at"]): string =>
  "percent" in at ? `percent:${at.percent}` : `quantity:${formatQuantity(at)}:${at.unit}`;
const target = (scope: BudgetScope): string => {
  switch (scope.kind) {
    case "principal":
      return scope.principal;
    case "group":
      return scope.group;
    case "connection":
      return scope.connection;
    case "access_credential":
      return `${scope.accessCredential.kind}:${scope.accessCredential.id}`;
    case "platform_pool":
      return scope.poolId;
    case "tag":
      return scope.tag;
  }
};
const traffic = (surface: Budget["surface"]): BudgetRow["traffic"] =>
  surface === "any"
    ? { kind: "any" }
    : surface === "app" || surface === "programmatic"
      ? { kind: "surface", surface }
      : { kind: "source", source: surface };
const display = (at: BudgetAlert["at"]): AlertAt =>
  "percent" in at ? { percent: at.percent } : quantityAmount(at);
const threshold = (b: Budget, at: BudgetAlert["at"]): Quantity | null =>
  "percent" in at ? (b.limit ? percentOf(b.limit, BigInt(at.percent)) : null) : at;

function percentText(q: Quantity, extent: Quantity): string {
  const scale = Math.max(q.scale, extent.scale),
    value = q.value * 10n ** BigInt(scale - q.scale),
    whole = extent.value * 10n ** BigInt(scale - extent.scale),
    capped = value > whole ? whole : value < 0n ? 0n : value;
  return formatQuantity({ value: (capped * 10000n) / whole, scale: 2, unit: "%" });
}
function geometry(
  b: Budget,
  used: Quantity,
  reserved: Quantity,
  total: Quantity,
): BudgetBar | null {
  if (!b.limit) return null;
  const outer = b.onExceed === "allow" && b.hardLimit ? b.hardLimit : b.limit,
    extent = compare(total, outer) > 0 ? total : outer;
  if (extent.value === 0n) return null;
  const at = (q: Quantity) => percentText(q, extent);
  return {
    used: at(used),
    reserved: at(reserved),
    limit: at(b.limit),
    hardLimit: b.onExceed === "allow" && b.hardLimit ? at(b.hardLimit) : null,
    alerts: (b.alerts ?? []).flatMap((a) => {
      const q = threshold(b, a.at);
      return q ? [at(q)] : [];
    }),
  };
}

function row(s: BudgetStatus, crossings: readonly BudgetAlertCrossed[]): BudgetRow {
  const b = s.budget;
  const common = {
    id: b.id,
    version: b.version,
    kind: b.scope.kind,
    target: target(b.scope),
    traffic: traffic(b.surface),
    window: b.window.kind,
    unit: b.unit,
    epoch: s.epoch.epoch,
    resetsAt: s.epoch.endsAt,
  };
  if (s.redacted || !s.used || !s.reserved)
    return {
      ...common,
      limit: "unavailable",
      used: "unavailable",
      reserved: "unavailable",
      remaining: "unavailable",
      boundary:
        b.onExceed === "allow"
          ? { onExceed: "allow", hardLimit: b.hardLimit ? "unavailable" : null }
          : { onExceed: "block" },
      alerts: [],
      bar: null,
      warningAt: null,
      redacted: true,
      level: "unavailable",
    };
  const total = plus(s.used, s.reserved);
  const received = new Set(
    crossings
      .filter((c) => c.budgetId === b.id && c.epoch === s.epoch.epoch)
      .map((c) => alertKey(c.at)),
  );
  const alerts = (b.alerts ?? []).map((a): BudgetAlertRow => {
    const at = threshold(b, a.at),
      key = alertKey(a.at);
    return {
      key,
      at: display(a.at),
      crossed: received.has(key) || (at !== null && compare(total, at) >= 0),
    };
  });
  const fallback =
    !b.alerts?.length && b.limit && compare(total, percentOf(b.limit, 80n)) >= 0
      ? { percent: 80 }
      : null;
  const warningAt = alerts.filter((a) => a.crossed).at(-1)?.at ?? fallback;
  let level: Level = warningAt ? "warning" : "ok";
  if (b.limit) {
    const outer = b.onExceed === "allow" && b.hardLimit ? b.hardLimit : b.limit;
    if (compare(total, outer) >= 0) level = "exceeded";
    else if (compare(total, b.limit) >= 0) level = "warning";
  }
  return {
    ...common,
    limit: b.limit ? quantityAmount(b.limit) : "unlimited",
    used: quantityAmount(s.used),
    reserved: quantityAmount(s.reserved, "estimated"),
    remaining:
      b.limit && s.remaining
        ? quantityAmount(s.remaining, s.reserved.value > 0n ? "estimated" : "measured")
        : "unlimited",
    boundary:
      b.onExceed === "allow"
        ? { onExceed: "allow", hardLimit: b.hardLimit ? quantityAmount(b.hardLimit) : null }
        : { onExceed: "block" },
    alerts,
    bar: geometry(b, s.used, s.reserved, total),
    warningAt,
    redacted: false,
    level,
  };
}

/** Pure mapping for hosts that already hold BudgetStatus rows. */
export function budgetsViewFromStatuses(
  statuses: readonly BudgetStatus[],
  crossings: readonly BudgetAlertCrossed[] = [],
): BudgetsView {
  const rows = statuses.map((s) => row(s, crossings));
  return { state: rows.length ? "ok" : "empty", rows, problem: null };
}

/** Every budget that applies to one operation shape, with redacted shared bounds kept visible. */
export async function loadBudgetsView(
  meter: Meter,
  access: AccessContext,
  input: BudgetsInput,
): Promise<BudgetsView> {
  const query: ApplicableBudgetsQuery = {
    scope: input.scope,
    surface: input.surface,
    units: input.units,
    ...(input.platformPools ? { platformPools: input.platformPools } : {}),
    ...(input.source ? { source: input.source } : {}),
  };
  const result = await attempt(() => meter.applicableBudgets(access, query));
  if (result.outcome === "forbidden") return { state: "forbidden", rows: [], problem: null };
  if (result.outcome === "unavailable")
    return { state: "unavailable", rows: [], problem: result.problem };
  return budgetsViewFromStatuses(result.value, input.crossings);
}
