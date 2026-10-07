import { addQuantity, formatQuantity } from "@usagekit/core";
import type { Quantity } from "@usagekit/core";
import type { Amount, Figure } from "./amount.js";

export type ProviderDecimalResult =
  | { outcome: "valid"; quantity: Quantity }
  | { outcome: "invalid"; reason: string };

/** Decimal text only. Host adapters must also enforce their native precision and storage bounds. */
export function parseProviderDecimal(
  text: string,
  unit: string,
  maximumScale = unit === "cents" || unit === "customer_cents" ? 4 : 18,
): ProviderDecimalResult {
  const invalid = (reason: string): ProviderDecimalResult => ({ outcome: "invalid", reason });
  if (!unit || !Number.isSafeInteger(maximumScale) || maximumScale < 0 || maximumScale > 18)
    return invalid("A unit and a scale from zero to eighteen are required.");
  if (typeof text !== "string" || text.length > 1024)
    return invalid("Enter a nonnegative decimal amount.");
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return invalid("Enter a nonnegative decimal amount.");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > maximumScale) return invalid(`Use at most ${maximumScale} decimal places.`);
  const quantity = { value: BigInt(whole! + fraction), scale: fraction.length, unit };
  if (
    (unit === "cents" || unit === "customer_cents") &&
    quantity.value * 10000n > (2n ** 63n - 1n) * 10n ** BigInt(quantity.scale)
  )
    return invalid("Amount exceeds the exact money storage range.");
  return { outcome: "valid", quantity };
}

function measured(figure: Figure): Quantity | null {
  if (figure === "unavailable" || figure.certainty !== "measured") return null;
  const parsed = parseProviderDecimal(figure.text, figure.unit);
  return parsed.outcome === "valid" ? parsed.quantity : null;
}

export type AvailableAllocationInput = {
  used: Figure;
  reserved: Figure;
  available: Figure;
  /** Does the host's spendable availability already subtract these local reservations? */
  availabilityBasis: "before_reservations" | "after_reservations";
};
export type AvailableAllocationResult =
  | { outcome: "ready"; limit: Amount }
  | { outcome: "unavailable"; reason: string };

/**
 * Suggests one limit from one authority, never a wallet or provider balance mutation.
 * Before-reservation availability includes the held headroom; after-reservation availability
 * has already removed it. Native provider units and customer charges must be supplied separately.
 */
export function allocationLimitFromAvailable(
  input: AvailableAllocationInput,
): AvailableAllocationResult {
  const used = measured(input.used);
  const reserved = measured(input.reserved);
  const available = measured(input.available);
  if (!used || !reserved || !available)
    return {
      outcome: "unavailable",
      reason: "Measured usage, reservations and availability are required.",
    };
  if (used.unit !== reserved.unit || used.unit !== available.unit)
    return {
      outcome: "unavailable",
      reason: "Usage, reservations and availability must share one unit.",
    };
  if (
    input.availabilityBasis !== "before_reservations" &&
    input.availabilityBasis !== "after_reservations"
  )
    return {
      outcome: "unavailable",
      reason: "The host must identify how availability accounts for reservations.",
    };
  let limit = addQuantity(used, available);
  if (input.availabilityBasis === "after_reservations") limit = addQuantity(limit, reserved);
  const bounded = parseProviderDecimal(formatQuantity(limit), limit.unit);
  if (bounded.outcome === "invalid") return { outcome: "unavailable", reason: bounded.reason };
  return {
    outcome: "ready",
    limit: { text: formatQuantity(limit), unit: limit.unit, certainty: "measured" },
  };
}

export type BudgetProjectionInput = {
  used: Figure;
  reserved: Figure;
  limit: Figure;
  periodStart: string;
  asOf: string;
  periodEnd: string;
};
export type BudgetProjection =
  | { kind: "unavailable"; reason: string }
  | { kind: "no_usage" }
  | { kind: "within_limits" }
  | { kind: "exhausted"; at: string }
  | { kind: "estimated"; at: string; basis: "observed_average" };

/** Exact average-pace estimate. Reservations consume headroom but never count as settled spend. */
export function projectBudgetExhaustion(input: BudgetProjectionInput): BudgetProjection {
  const used = measured(input.used);
  const reserved = measured(input.reserved);
  const limit = measured(input.limit);
  const start = Date.parse(input.periodStart);
  const at = Date.parse(input.asOf);
  const end = Date.parse(input.periodEnd);
  if (!used || !reserved || !limit || used.unit !== reserved.unit || used.unit !== limit.unit)
    return { kind: "unavailable", reason: "Measured values in the same unit are required." };
  if (![start, at, end].every(Number.isSafeInteger) || !(start < at && at < end))
    return { kind: "unavailable", reason: "Observation must be inside a valid budget period." };
  const scale = Math.max(used.scale, reserved.scale, limit.scale);
  const scaled = (q: Quantity) => q.value * 10n ** BigInt(scale - q.scale);
  const spent = scaled(used);
  const remaining = scaled(limit) - spent - scaled(reserved);
  if (remaining <= 0n) return { kind: "exhausted", at: new Date(at).toISOString() };
  if (spent === 0n) return { kind: "no_usage" };
  const numerator = remaining * BigInt(at - start);
  const delta = (numerator + spent - 1n) / spent;
  if (delta >= BigInt(end - at)) return { kind: "within_limits" };
  return {
    kind: "estimated",
    at: new Date(at + Number(delta)).toISOString(),
    basis: "observed_average",
  };
}
