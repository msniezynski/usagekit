import { expect, test } from "vitest";
import { decodeMeterJson } from "./wire.js";
test("integer conversion follows DTO shapes rather than generic field names", () => {
  const data = {
    metadata: { value: "0007", units: "0008", unknownOperations: "0009" },
    money: { currency: "USD", units: "9223372036854775807" },
    quantity: { unit: "units", value: "1", scale: 18 },
    query: { units: ["42"] },
    row: {
      dimensions: { provider: "example" },
      measurements: [],
      cost: { certainty: "unknown", money: null },
      fundingSource: "byok",
      costOwner: "u",
      unknownOperations: "2",
    },
  };
  expect(decodeMeterJson(JSON.stringify(data))).toEqual({
    ...data,
    money: { currency: "USD", units: 9223372036854775807n },
    quantity: { unit: "units", value: 1n, scale: 18 },
    row: { ...data.row, unknownOperations: 2n },
  });
});
