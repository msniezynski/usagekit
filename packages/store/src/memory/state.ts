import type { DispatchGrant } from "@usagekit/core";
import type { UsageRow } from "@usagekit/core";
import type { SettleResult, ReleaseResult } from "@usagekit/core";
import type { AllowanceExceeded } from "@usagekit/core";
import type { Budget, Operation, ReserveInput, OperationRef, Quantity } from "@usagekit/core";
import type { Clock } from "../clock.js";
export class InvalidInput extends Error {
  constructor(
    readonly field: string,
    readonly reason = "invalid value",
  ) {
    super(`InvalidInput: ${field}: ${reason}`);
  }
}
export const copy = <T>(value: T): T => structuredClone(value);
export function canonical(value: unknown): string {
  if (typeof value === "bigint") return `"bigint:${value}"`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const key = (namespace: string, id: string) => canonical([namespace, id]);
export function semantics(i: ReserveInput): string {
  const { correlationId: _, parentOperationId: __, ...rest } = i;
  return canonical({
    ...rest,
    estimate: [...i.estimate].sort((a, b) => a.unit.localeCompare(b.unit)),
    platformPools: [...(i.platformPools ?? [])].sort(),
  });
}
export const maxMoneyUnits = 2n ** 63n - 1n;
export function validateQuantity(q: Quantity): void {
  if (
    typeof q.value !== "bigint" ||
    q.value < 0n ||
    !Number.isInteger(q.scale) ||
    q.scale < 0 ||
    q.scale > 18 ||
    !q.unit?.trim()
  )
    throw new InvalidInput("quantity");
  if (q.unit === "cents" && q.value * 10000n > maxMoneyUnits * 10n ** BigInt(q.scale))
    throw new InvalidInput("quantity", "money storage bound");
}
export type State = {
  /** Optional adapter projection, read in the same transaction as admission. */
  readBudgetUsage?: (budget: Budget, epoch: string) => { used: Quantity; reserved: Quantity };
  cursors: Map<
    string,
    { query: string; rows: UsageRow[]; asOf: string; watermark: string; offset: number }
  >;
  clock: Clock;
  budgets: Budget[];
  operations: Map<string, Operation>;
  identities: Map<string, string>;
  commands: Map<string, { identity: string; result: SettleResult | ReleaseResult | DispatchGrant }>;
  leaseKinds: Map<string, "lease" | "recovery">;
  warnings: Map<string, readonly AllowanceExceeded[]>;
};
export function find(s: State, ref: OperationRef): Operation | null {
  const op = s.operations.get(key(ref.namespace, ref.operationId));
  return op?.scope.principal === ref.principal ? op : null;
}
