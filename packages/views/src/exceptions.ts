import type {
  AccessContext,
  LifecycleState,
  Meter,
  Operation,
  Source,
  UsageScope,
} from "@usagekit/core";
import { attempt, quantityAmount } from "./amount.js";
import type { Amount, Problem, ViewState } from "./amount.js";

export type ExceptionKind = "reservation_expired" | "lease_expired" | "pending";
export type ExceptionRow = {
  operationId: string;
  principal: string;
  connection: string;
  provider: string;
  operation: string;
  source: Source;
  state: LifecycleState;
  kind: ExceptionKind;
  /** When the exception began: reservation expiry, lease expiry, or the last update of pending work. */
  since: string;
  ageSeconds: number;
  estimate: readonly Amount[];
};
export type ExceptionsView = {
  state: ViewState;
  rows: readonly ExceptionRow[];
  nextCursor: string | null;
  asOf: string | null;
  problem: Problem | null;
};
export type ExceptionsInput = {
  scope: UsageScope;
  from: string;
  to: string;
  connection?: string;
  limit?: number;
  cursor?: string;
};

/** Expired dispatch leases need recovery first; pending work without one awaits evidence. */
export function classify(
  op: Operation,
  asOf: string,
): { kind: ExceptionKind; since: string } | null {
  const now = Date.parse(asOf);
  if (op.state === "reserved")
    return Date.parse(op.reservationExpiresAt) <= now
      ? { kind: "reservation_expired", since: op.reservationExpiresAt }
      : null;
  if (op.state !== "dispatch_intended" && op.state !== "pending") return null;
  if (op.lease && Date.parse(op.lease.expiresAt) <= now)
    return { kind: "lease_expired", since: op.lease.expiresAt };
  return op.state === "pending" ? { kind: "pending", since: op.updatedAt } : null;
}

/** One listing page classified at its asOf; a page may hold fewer rows than limit. */
export async function loadExceptionsView(
  meter: Meter,
  access: AccessContext,
  input: ExceptionsInput,
): Promise<ExceptionsView> {
  const blank = { rows: [], nextCursor: null, asOf: null };
  const result = await attempt(() =>
    meter.listOperations(access, {
      ...input,
      states: ["reserved", "dispatch_intended", "pending"],
    }),
  );
  if (result.outcome === "forbidden") return { ...blank, state: "forbidden", problem: null };
  if (result.outcome === "unavailable")
    return { ...blank, state: "unavailable", problem: result.problem };
  const page = result.value,
    now = Date.parse(page.asOf);
  const rows = page.operations.flatMap((op): ExceptionRow[] => {
    const found = classify(op, page.asOf);
    if (!found) return [];
    return [
      {
        operationId: op.operationId,
        principal: op.scope.principal,
        connection: op.scope.connection,
        provider: op.provider,
        operation: op.operation,
        source: op.source,
        state: op.state,
        ...found,
        ageSeconds: Math.max(0, Math.floor((now - Date.parse(found.since)) / 1000)),
        estimate: op.estimate.map((q) => quantityAmount(q, "estimated")),
      },
    ];
  });
  const nextCursor = page.nextCursor ?? null;
  return {
    state: rows.length || nextCursor ? "ok" : "empty",
    rows,
    nextCursor,
    asOf: page.asOf,
    problem: null,
  };
}
