import { sourcesOf, normalizeTags } from "@usagekit/core";
import type {
  EstimateSource,
  ValidationFailure,
  ReserveInput,
  UsageQuery,
  ApplicableBudgetsQuery,
  OperationsQuery,
  RequestCountsQuery,
} from "@usagekit/core";
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
/** The host sets both fields at authentication; a source outside its surface group is a forgery or a bug. */
export function sourceValidation(
  i: Pick<ApplicableBudgetsQuery, "surface" | "source">,
): ValidationFailure | null {
  if (i.source !== undefined && !sourcesOf(i.surface)?.includes(i.source))
    return { outcome: "invalid", field: "source", reason: "source outside surface group" };
  return null;
}
export function reserveValidation(i: ReserveInput): ValidationFailure | null {
  const error = validate(i) ?? sourceValidation(i);
  if (error) return error;
  if (i.scope.tags !== undefined && !normalizeTags(i.scope.tags))
    return {
      outcome: "invalid",
      field: "scope.tags",
      reason: "1 to 16 unique tags matching the tag pattern",
    };
  if (new Set(i.estimate.map((q) => q.unit)).size !== i.estimate.length)
    return { outcome: "invalid", field: "estimate", reason: "duplicate unit" };
  return null;
}
const lifecycle = ["reserved", "dispatch_intended", "pending", "settled", "released"];
function windowValidation(q: Pick<UsageQuery, "from" | "to" | "limit">): ValidationFailure | null {
  if (
    !Number.isFinite(Date.parse(q.from)) ||
    !Number.isFinite(Date.parse(q.to)) ||
    Date.parse(q.from) > Date.parse(q.to)
  )
    return { outcome: "invalid", field: "window", reason: "invalid time interval" };
  if (q.limit !== undefined && (q.limit < 1 || q.limit > 1000))
    return { outcome: "invalid", field: "limit", reason: "must be between 1 and 1000" };
  return null;
}
export function operationsValidation(q: OperationsQuery): ValidationFailure | null {
  const error = validate(q) ?? windowValidation(q);
  if (error) return error;
  if (
    q.states !== undefined &&
    (q.states.length < 1 || q.states.some((state) => !lifecycle.includes(state)))
  )
    return { outcome: "invalid", field: "states", reason: "one or more lifecycle states" };
  return null;
}
export function usageValidation(q: UsageQuery): ValidationFailure | null {
  const error = validate(q) ?? windowValidation(q);
  if (error) return error;
  if (q.groupBy.includes("principal") && !["namespace", "group"].includes(q.scope.kind))
    return {
      outcome: "invalid",
      field: "groupBy",
      reason: "principal requires group or namespace scope",
    };
  return null;
}
const estimateSources: readonly EstimateSource[] = ["manual", "measured", "list", "unknown"];
/** Hosts may name the source; a value outside the catalog order is rejected before Store. */
export function provenanceValidation(i: { estimateSource?: string }): ValidationFailure | null {
  if (
    i.estimateSource !== undefined &&
    !estimateSources.includes(i.estimateSource as EstimateSource)
  )
    return { outcome: "invalid", field: "estimateSource", reason: "unknown estimate source" };
  return null;
}
export function requestCountsValidation(q: RequestCountsQuery): ValidationFailure | null {
  return validate(q) ?? windowValidation(q);
}
