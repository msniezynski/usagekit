import type { PriceRow, Quantity } from "@usagekit/core";
import type { EstimateInput } from "./types.js";
import { decimalQuantity } from "./receipts.js";

/**
 * The price row behind a list estimate. Rows must name the operation, match the connection plan
 * (rows without plan apply to any plan) and the overage state, and every option they name must
 * equal the request option. Plan-specific rows beat any-plan rows, then rows naming more options
 * win, then later validFrom. An operation priced per plan resolves nothing without a plan.
 */
export function selectPriceRow(input: EstimateInput): PriceRow | undefined {
  const rows = input.prices.filter((r) => r.operation === input.operation.id);
  if (input.plan === undefined && rows.some((r) => r.plan !== undefined)) return undefined;
  const candidates = rows.filter(
    (r) =>
      (r.plan === undefined || r.plan === input.plan) &&
      Boolean(r.overage) === Boolean(input.overage) &&
      Object.entries(r.option ?? {}).every(([k, v]) => input.options[k] === v),
  );
  const rank = (r: PriceRow) => [r.plan ? 1 : 0, Object.keys(r.option ?? {}).length] as const;
  return candidates.sort((a, b) => {
    const [ap, ao] = rank(a),
      [bp, bo] = rank(b);
    return bp - ap || bo - ao || b.validFrom.localeCompare(a.validFrom);
  })[0];
}

/** Default estimate: one call at the selected row's per-unit price; empty without a row. */
export function listEstimate(input: EstimateInput): Quantity[] {
  const row = selectPriceRow(input);
  return row ? [decimalQuantity(row.perUnit, row.unit)] : [];
}
