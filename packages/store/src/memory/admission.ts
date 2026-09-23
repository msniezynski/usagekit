import { defaultBudgetOrder } from "@usagekit/core";
import type { AdmissionPolicy } from "@usagekit/core";
import { resolveWindow } from "@usagekit/core";
import type {
  Budget,
  BudgetScope,
  ReserveInput,
  ApplicableBudgetsQuery,
  Quantity,
  BudgetStatus,
  AllowanceExceeded,
  Operation,
} from "@usagekit/core";
import { canonical } from "./state.js";
import type { State } from "./state.js";

export function currentBudgets(s: State): Budget[] {
  const map = new Map<string, Budget>();
  for (const b of s.budgets) {
    const k = canonical([b.scope.namespace, b.id]);
    if ((map.get(k)?.version ?? -1) < b.version) map.set(k, b);
  }
  return [...map.values()];
}
export function matches(
  b: Budget,
  i: Pick<ReserveInput, "scope" | "surface" | "platformPools">,
): boolean {
  if (b.scope.namespace !== i.scope.namespace || (b.surface !== "any" && b.surface !== i.surface))
    return false;
  switch (b.scope.kind) {
    case "principal":
      return b.scope.principal === i.scope.principal;
    case "group":
      return b.scope.group === i.scope.group;
    case "connection":
      return b.scope.connection === i.scope.connection;
    case "access_credential":
      return canonical(b.scope.accessCredential) === canonical(i.scope.accessCredential);
    case "platform_pool":
      return i.platformPools?.includes(b.scope.poolId) ?? false;
  }
}
export function plus(a: Quantity, b: Quantity): Quantity {
  const scale = Math.max(a.scale, b.scale);
  return {
    unit: a.unit,
    scale,
    value: a.value * 10n ** BigInt(scale - a.scale) + b.value * 10n ** BigInt(scale - b.scale),
  };
}
export const greater = (a: Quantity, b: Quantity) =>
  a.value * 10n ** BigInt(b.scale) > b.value * 10n ** BigInt(a.scale);
export function effective(op: Operation) {
  return [...op.receipts]
    .reverse()
    .find((r) => !op.receipts.some((next) => next.supersedes === r.id));
}
export function status(s: State, b: Budget): BudgetStatus {
  const epoch = resolveWindow(b.window, s.clock.now());
  let used: Quantity = { value: 0n, scale: 0, unit: b.unit },
    reserved = { ...used };
  const projected = s.readBudgetUsage?.(b, epoch.epoch);
  if (projected) {
    used = projected.used;
    reserved = projected.reserved;
  } else
    for (const op of s.operations.values()) {
      if (
        op.scope.namespace !== b.scope.namespace ||
        !op.budgetEpochs.some((e) => e.budgetId === b.id && e.epoch === epoch.epoch)
      )
        continue;
      if (op.state === "settled") {
        const m = effective(op)?.measurements.find((m) => m.unit === b.unit);
        if (m?.quantity) used = plus(used, m.quantity);
      } else if (op.state !== "released") {
        const q = op.estimate.find((q) => q.unit === b.unit);
        if (q) reserved = plus(reserved, q);
      }
    }
  const total = plus(used, reserved);
  const remaining = b.limit ? plus(b.limit, { ...total, value: -total.value }) : null;
  return { budget: b, epoch, used, reserved, remaining };
}
export function applicable(s: State, i: ApplicableBudgetsQuery): BudgetStatus[] {
  return currentBudgets(s)
    .filter((b) => matches(b, i))
    .map((b) => status(s, b));
}
export function admission(s: State, i: ReserveInput, policy?: AdmissionPolicy) {
  const order = policy?.budgetOrder ?? defaultBudgetOrder;
  const budgets = currentBudgets(s)
    .filter((b) => matches(b, i))
    .sort(
      (a, b) =>
        order.indexOf(a.scope.kind) - order.indexOf(b.scope.kind) || a.id.localeCompare(b.id),
    );
  const warnings: AllowanceExceeded[] = [],
    epochs: Operation["budgetEpochs"][number][] = [];
  for (const b of budgets) {
    const estimate = i.estimate.find((q) => q.unit === b.unit);
    if (!estimate) return { invalid: b.unit, warnings, epochs };
  }
  for (const b of budgets) {
    const st = status(s, b);
    epochs.push({ budgetId: b.id, budgetVersion: b.version, ...st.epoch });
    const estimate = i.estimate.find((q) => q.unit === b.unit)!;
    if (b.limit && greater(plus(plus(st.used!, st.reserved!), estimate), b.limit)) {
      const exceeded: AllowanceExceeded = {
        code: "allowance_exceeded",
        budget: b,
        used: st.used!,
        reserved: st.reserved!,
        resetsAt: st.epoch.endsAt,
      };
      if (b.onExceed === "block") return { exceeded, warnings, epochs };
      warnings.push(exceeded);
    }
  }
  return { warnings, epochs };
}
