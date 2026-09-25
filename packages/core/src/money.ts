import type { Money } from "./contracts.js";
export function fromDecimalString(cents: string, options: { allowNegative?: boolean } = {}): Money {
  if (!/^-?\d+(\.\d{1,4})?$/.test(cents) || (!options.allowNegative && cents.startsWith("-")))
    throw new Error("InvalidInput: cents");
  const [whole, fraction = ""] = cents.replace("-", "").split(".");
  return {
    currency: "USD",
    units:
      (BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0"))) *
      (cents.startsWith("-") ? -1n : 1n),
  };
}
export function toDecimalString(m: Money): string {
  const n = m.units < 0n ? -m.units : m.units;
  return `${m.units < 0n ? "-" : ""}${n / 10000n}.${(n % 10000n).toString().padStart(4, "0")}`;
}
export const add = (a: Money, b: Money): Money => ({ currency: "USD", units: a.units + b.units });
export const sub = (a: Money, b: Money): Money => ({ currency: "USD", units: a.units - b.units });
export const compare = (a: Money, b: Money): -1 | 0 | 1 =>
  a.units < b.units ? -1 : a.units > b.units ? 1 : 0;
/** Exact cents text with four fractional digits; a named alias of toDecimalString for views. */
export const formatMoney: (m: Money) => string = toDecimalString;
