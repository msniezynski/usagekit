import { expect, test } from "vitest";
import type { Cost, Quantity } from "./index.js";

test("contract fixtures retain exact bigint quantities and unknown cost", () => {
  const quantity: Quantity = { value: 9007199254740993n, scale: 4, unit: "units" };
  const cost: Cost = { certainty: "unknown", money: null };
  expect(quantity.value + 1n).toBe(9007199254740994n);
  expect(cost.money).toBeNull();
});
