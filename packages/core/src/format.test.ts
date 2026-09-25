import { expect, test } from "vitest";
import fc from "fast-check";
import {
  formatMoney,
  formatQuantity,
  fromDecimalString,
  normalizeScale,
  toDecimalString,
} from "./index.js";

const q = (value: bigint, scale: number) => ({ value, scale, unit: "units" });

test("formatQuantity prints the exact decimal with trailing zeros trimmed", () => {
  expect(formatQuantity(q(0n, 0))).toBe("0");
  expect(formatQuantity(q(0n, 6))).toBe("0");
  expect(formatQuantity(q(12n, 0))).toBe("12");
  expect(formatQuantity(q(12n, 1))).toBe("1.2");
  expect(formatQuantity(q(120n, 2))).toBe("1.2");
  expect(formatQuantity(q(100n, 2))).toBe("1");
  expect(formatQuantity(q(5n, 3))).toBe("0.005");
  expect(formatQuantity(q(1n, 18))).toBe("0.000000000000000001");
  expect(formatQuantity(q(10n ** 30n + 1n, 18))).toBe("1000000000000.000000000000000001");
  expect(formatQuantity(q(-15n, 1))).toBe("-1.5");
});

test("formatQuantity never has a trailing dot or a missing leading digit", () => {
  for (const [value, scale] of [
    [10n, 1],
    [1n, 1],
    [1000n, 3],
  ] as const) {
    const text = formatQuantity(q(value, scale));
    expect(text.endsWith(".")).toBe(false);
    expect(text.startsWith(".")).toBe(false);
  }
});

test("formatMoney is the exact cents string of toDecimalString", () => {
  expect(formatMoney).toBe(toDecimalString);
  expect(formatMoney(fromDecimalString("0.0001"))).toBe("0.0001");
  expect(formatMoney(fromDecimalString("12"))).toBe("12.0000");
  expect(formatMoney(fromDecimalString("-3.5", { allowNegative: true }))).toBe("-3.5000");
});

test("money round-trips through fromDecimalString", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }), (units) => {
      const money = { units, currency: "USD" as const };
      expect(fromDecimalString(formatMoney(money), { allowNegative: true })).toEqual(money);
    }),
  );
});

test("a quantity in cents at scale 0..4 reads back through fromDecimalString", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 2n ** 60n }), fc.integer({ min: 0, max: 4 }), (v, s) => {
      const money = fromDecimalString(formatQuantity(q(v, s)));
      expect(money.units).toBe(v * 10n ** BigInt(4 - s));
    }),
  );
});

test("formatting is invariant under normalizeScale", () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 0n, max: 2n ** 64n }),
      fc.integer({ min: 0, max: 18 }),
      fc.integer({ min: 0, max: 18 }),
      (v, s, extra) => {
        const target = Math.min(18, s + extra);
        expect(formatQuantity(normalizeScale(q(v, s), target))).toBe(formatQuantity(q(v, s)));
      },
    ),
  );
});

test("formatting never loses precision for scales 0..18", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 2n ** 96n }), fc.integer({ min: 0, max: 18 }), (v, s) => {
      const text = formatQuantity(q(v, s));
      expect(text).toMatch(/^\d+(\.\d*[1-9])?$/);
      const [whole, fraction = ""] = text.split(".");
      expect(fraction.length).toBeLessThanOrEqual(s);
      expect(BigInt(whole! + fraction.padEnd(s, "0"))).toBe(v);
    }),
  );
});
