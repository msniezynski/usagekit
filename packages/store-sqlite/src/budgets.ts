import type Database from "better-sqlite3";
import { resolveWindow, defaultBudgetOrder } from "@usagekit/core";
import type {
  Budget,
  BudgetStatus,
  ApplicableBudgetsQuery,
  ReserveInput,
  AdmissionPolicy,
  Operation,
  AllowanceExceeded,
} from "@usagekit/core";
import { decode, encode, integer } from "./serialize.js";
import { canonical, plus, greater, effective } from "./util.js";
export function insertBudget(db: Database.Database, b: Budget, fixture = false): void {
  db.prepare(
    `INSERT INTO budgets VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ${fixture ? "ON CONFLICT(namespace,budget_id,version) DO UPDATE SET scope_json=excluded.scope_json,scope_kind=excluded.scope_kind,scope_key=excluded.scope_key,surface=excluded.surface,unit=excluded.unit,limit_value=excluded.limit_value,limit_scale=excluded.limit_scale,window_json=excluded.window_json,on_exceed=excluded.on_exceed,budget_json=excluded.budget_json" : ""}`,
  ).run(
    b.scope.namespace,
    b.id,
    b.version,
    encode(b.scope),
    b.scope.kind,
    canonical(b.scope),
    b.surface,
    b.unit,
    integer(b.limit?.value ?? null),
    b.limit?.scale ?? null,
    encode(b.window),
    b.onExceed,
    encode(b),
  );
}
export function currentBudgets(
  db: Database.Database,
  namespace?: string,
  scopeKeys?: string[],
  surface?: string,
): Budget[] {
  const clauses = [
      "NOT EXISTS(SELECT 1 FROM budgets n WHERE n.namespace=b.namespace AND n.budget_id=b.budget_id AND n.version>b.version)",
    ],
    args: string[] = [];
  if (namespace !== undefined) {
    clauses.push("b.namespace=?");
    args.push(namespace);
  }
  if (scopeKeys) {
    clauses.push(`b.scope_key IN (${scopeKeys.map(() => "?").join(",")})`);
    args.push(...scopeKeys);
  }
  if (surface) {
    clauses.push("b.surface IN ('any',?)");
    args.push(surface);
  }
  return (
    db
      .prepare(
        `SELECT b.budget_json FROM budgets b WHERE ${clauses.join(" AND ")} ORDER BY b.rowid`,
      )
      .all(...args) as { budget_json: string }[]
  ).map((r) => decode<Budget>(r.budget_json));
}
export function selected(
  db: Database.Database,
  i: Pick<ApplicableBudgetsQuery, "scope" | "surface" | "platformPools">,
): Budget[] {
  const { namespace, principal, connection, group, accessCredential } = i.scope;
  const scopes: Budget["scope"][] = [
    { kind: "principal", namespace, principal },
    { kind: "connection", namespace, connection },
  ];
  if (group) scopes.push({ kind: "group", namespace, group });
  if (accessCredential) scopes.push({ kind: "access_credential", namespace, accessCredential });
  for (const poolId of i.platformPools ?? [])
    scopes.push({ kind: "platform_pool", namespace, poolId });
  return currentBudgets(db, namespace, scopes.map(canonical), i.surface);
}
export function status(db: Database.Database, b: Budget, now: Date): BudgetStatus {
  const epoch = resolveWindow(b.window, now);
  const row = db
    .prepare(
      "SELECT settled_value,outstanding_value,scale FROM budget_usage WHERE namespace=? AND budget_id=? AND epoch=?",
    )
    .get(b.scope.namespace, b.id, epoch.epoch) as
    | { settled_value: bigint; outstanding_value: bigint; scale: bigint }
    | undefined;
  const used = { unit: b.unit, value: row?.settled_value ?? 0n, scale: Number(row?.scale ?? 0) },
    reserved = { ...used, value: row?.outstanding_value ?? 0n },
    total = plus(used, reserved);
  return {
    budget: b,
    epoch,
    used,
    reserved,
    remaining: b.limit ? plus(b.limit, { ...total, value: -total.value }) : null,
  };
}
export function admission(db: Database.Database, i: ReserveInput, now: Date, p?: AdmissionPolicy) {
  const order = p?.budgetOrder ?? defaultBudgetOrder,
    budgets = selected(db, i).sort(
      (a, b) =>
        order.indexOf(a.scope.kind) - order.indexOf(b.scope.kind) || a.id.localeCompare(b.id),
    ),
    warnings: AllowanceExceeded[] = [],
    epochs: Operation["budgetEpochs"][number][] = [];
  for (const b of budgets)
    if (!i.estimate.some((q) => q.unit === b.unit)) return { invalid: b.unit, warnings, epochs };
  for (const b of budgets) {
    const s = status(db, b, now);
    epochs.push({ budgetId: b.id, budgetVersion: b.version, ...s.epoch });
    const estimate = i.estimate.find((q) => q.unit === b.unit)!;
    if (b.limit && greater(plus(plus(s.used!, s.reserved!), estimate), b.limit)) {
      const exceeded: AllowanceExceeded = {
        code: "allowance_exceeded",
        budget: b,
        used: s.used!,
        reserved: s.reserved!,
        resetsAt: s.epoch.endsAt,
      };
      if (b.onExceed === "block") return { exceeded, warnings, epochs };
      warnings.push(exceeded);
    }
  }
  return { warnings, epochs };
}
/** Apply only this operation's old/new contribution. Caller owns the write transaction. */
export function updateUsage(
  db: Database.Database,
  before: Operation | null,
  after: Operation,
): void {
  for (const epoch of after.budgetEpochs) {
    const b = decode<Budget>(
      (
        db
          .prepare(
            "SELECT budget_json FROM budgets WHERE namespace=? AND budget_id=? AND version=?",
          )
          .get(after.scope.namespace, epoch.budgetId, epoch.budgetVersion) as {
          budget_json: string;
        }
      ).budget_json,
    );
    const zero = { unit: b.unit, value: 0n, scale: 0 };
    const contribution = (op: Operation | null) => ({
      used:
        op?.state === "settled"
          ? (effective(op)?.measurements.find((m) => m.unit === b.unit)?.quantity ?? zero)
          : zero,
      reserved:
        op && op.state !== "released" && op.state !== "settled"
          ? (op.estimate.find((q) => q.unit === b.unit) ?? zero)
          : zero,
    });
    const old = contribution(before),
      next = contribution(after),
      du = plus(next.used, { ...old.used, value: -old.used.value }),
      dr = plus(next.reserved, { ...old.reserved, value: -old.reserved.value });
    if (du.value === 0n && dr.value === 0n) continue;
    const row = db
      .prepare(
        "SELECT settled_value,outstanding_value,scale FROM budget_usage WHERE namespace=? AND budget_id=? AND epoch=?",
      )
      .get(after.scope.namespace, b.id, epoch.epoch) as
      | { settled_value: bigint; outstanding_value: bigint; scale: bigint }
      | undefined;
    const u = plus(
        { ...zero, value: row?.settled_value ?? 0n, scale: Number(row?.scale ?? 0) },
        du,
      ),
      r = plus(
        { ...zero, value: row?.outstanding_value ?? 0n, scale: Number(row?.scale ?? 0) },
        dr,
      ),
      scale = Math.max(u.scale, r.scale);
    db.prepare(
      "INSERT INTO budget_usage VALUES(?,?,?,?,?,?) ON CONFLICT(namespace,budget_id,epoch) DO UPDATE SET settled_value=excluded.settled_value,outstanding_value=excluded.outstanding_value,scale=excluded.scale",
    ).run(
      after.scope.namespace,
      b.id,
      epoch.epoch,
      integer(u.value * 10n ** BigInt(scale - u.scale)),
      integer(r.value * 10n ** BigInt(scale - r.scale)),
      scale,
    );
  }
}
