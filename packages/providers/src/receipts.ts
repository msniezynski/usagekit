import type { Measurement, Money, Quantity } from "@usagekit/core";

const decimalPattern = /^(\d+)(?:\.(\d+))?$/;
/** Exact quantity of a nonnegative decimal string in a unit: "0.0150" cents is 150 at scale 4. */
export function decimalQuantity(text: string, unit: string): Quantity {
  const m = decimalPattern.exec(text);
  if (!m || (m[2]?.length ?? 0) > 18) throw new Error(`InvalidDecimal: ${text}`);
  return { value: BigInt(m[1]! + (m[2] ?? "")), scale: m[2]?.length ?? 0, unit };
}
/** Exact decimal text of a JSON number, rounded to at most `digits` fractional digits. */
export function numberText(n: number, digits: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`InvalidDecimal: ${n}`);
  const fixed = n.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
/** Money from a cents decimal string with up to four fractional digits. */
export function moneyFromCents(cents: string): Money {
  const q = decimalQuantity(cents, "cents");
  if (q.scale > 4) throw new Error(`InvalidDecimal: ${cents}`);
  return { units: q.value * 10n ** BigInt(4 - q.scale), currency: "USD" };
}
/** Money from a USD amount reported as a JSON number; 1 USD is 1_000_000 money units. */
export function moneyFromDollars(dollars: number): Money {
  const q = decimalQuantity(numberText(dollars, 6), "usd");
  return { units: q.value * 10n ** BigInt(6 - q.scale), currency: "USD" };
}
export const requestsMeasured = (count = 1n): Measurement => ({
  unit: "requests",
  quantity: { value: count, scale: 0, unit: "requests" },
  certainty: "measured",
});
