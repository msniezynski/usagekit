import type { ValidationFailure, ReserveInput, UsageQuery } from "@usagekit/core";
export function validate(value: unknown, field = "input"): ValidationFailure | null {
  const fail = (reason: string): ValidationFailure => ({ outcome: "invalid", field, reason });
  if (typeof value === "string" && !value.trim()) return fail("empty string");
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    return fail("expected nonnegative integer");
  if (typeof value === "bigint" && value < 0n) return fail("expected nonnegative quantity");
  if (value && typeof value === "object") {
    if ("unit" in value && "value" in value) {
      const q = value as unknown as { value: unknown; scale: number };
      if (typeof q.value !== "bigint" || !Number.isInteger(q.scale) || q.scale < 0 || q.scale > 18)
        return fail("invalid quantity");
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "evidenceRef" && child === "") continue;
      const error = validate(child, field === "input" ? key : field);
      if (error) return error;
    }
  }
  return null;
}
export function reserveValidation(i: ReserveInput): ValidationFailure | null {
  const error = validate(i);
  if (error) return error;
  if (new Set(i.estimate.map((q) => q.unit)).size !== i.estimate.length)
    return { outcome: "invalid", field: "estimate", reason: "duplicate unit" };
  return null;
}
export function usageValidation(q: UsageQuery): ValidationFailure | null {
  const error = validate(q);
  if (error) return error;
  if (
    !Number.isFinite(Date.parse(q.from)) ||
    !Number.isFinite(Date.parse(q.to)) ||
    Date.parse(q.from) > Date.parse(q.to)
  )
    return { outcome: "invalid", field: "window", reason: "invalid time interval" };
  if (q.limit !== undefined && (q.limit < 1 || q.limit > 1000))
    return { outcome: "invalid", field: "limit", reason: "must be between 1 and 1000" };
  if (q.groupBy.includes("principal") && !["namespace", "group"].includes(q.scope.kind))
    return {
      outcome: "invalid",
      field: "groupBy",
      reason: "principal requires group or namespace scope",
    };
  return null;
}
