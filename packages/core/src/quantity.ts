import type { Quantity } from "./contracts.js";
export function normalizeScale(q: Quantity, scale: number): Quantity {
  if (!Number.isSafeInteger(scale) || scale < q.scale || scale > 18)
    throw new Error("InvalidInput: scale");
  return { ...q, scale, value: q.value * 10n ** BigInt(scale - q.scale) };
}
function pair(a: Quantity, b: Quantity) {
  if (a.unit !== b.unit) throw new Error("UnitMismatch");
  const scale = Math.max(a.scale, b.scale);
  return [normalizeScale(a, scale), normalizeScale(b, scale)] as const;
}
export function add(a: Quantity, b: Quantity): Quantity {
  const [x, y] = pair(a, b);
  return { ...x, value: x.value + y.value };
}
export function compare(a: Quantity, b: Quantity): -1 | 0 | 1 {
  const [x, y] = pair(a, b);
  return x.value < y.value ? -1 : x.value > y.value ? 1 : 0;
}
/** Exact decimal text of value * 10^-scale, trailing fractional zeros trimmed, no trailing dot. */
export function format(q: Quantity): string {
  const negative = q.value < 0n,
    digits = (negative ? -q.value : q.value).toString().padStart(q.scale + 1, "0"),
    whole = digits.slice(0, digits.length - q.scale),
    fraction = digits.slice(digits.length - q.scale).replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== "0" ? `-${text}` : text;
}
