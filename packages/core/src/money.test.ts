import { expect, test } from "vitest";
import { fromDecimalString, toDecimalString, add, sub, compare } from "./money.js";
import * as q from "./quantity.js";
test("decimal cents are exact and bounded to four fractional digits", () => {
  expect(fromDecimalString("0.0001").units).toBe(1n);
  expect(fromDecimalString("12.3456").units).toBe(123456n);
  expect(() => fromDecimalString("0.00001")).toThrow();
  expect(() => fromDecimalString("-1")).toThrow();
  expect(toDecimalString(fromDecimalString("-1.23", { allowNegative: true }))).toBe("-1.2300");
  expect(() => fromDecimalString("NaN")).toThrow();
});
test("ten thousand tiny receipts add without rounding", () => {
  let m = fromDecimalString("0");
  for (let n = 0; n < 10000; n++) m = add(m, fromDecimalString("0.0001"));
  expect(m.units).toBe(10000n);
  expect(sub(m, fromDecimalString("1")).units).toBe(0n);
  expect(compare(m, fromDecimalString("2"))).toBe(-1);
  expect(compare(m, m)).toBe(0);
  expect(compare(m, fromDecimalString("0"))).toBe(1);
});
test("quantities normalize scale, compare and reject different units", () => {
  const a = { value: 12n, scale: 1, unit: "units" },
    b = { value: 1n, scale: 2, unit: "units" };
  expect(q.add(a, b)).toEqual({ value: 121n, scale: 2, unit: "units" });
  expect(q.normalizeScale(a, 2).value).toBe(120n);
  expect(q.compare(a, b)).toBe(1);
  expect(q.compare(b, a)).toBe(-1);
  expect(q.compare(a, a)).toBe(0);
  expect(() => q.add(a, { ...b, unit: "other" })).toThrow("UnitMismatch");
  expect(() => q.normalizeScale(a, 0)).toThrow();
});
