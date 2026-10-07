import { expect, test } from "vitest";
import type { Figure } from "./amount.js";
import {
  allocationLimitFromAvailable,
  parseProviderDecimal,
  projectBudgetExhaustion,
} from "./provider-budget-tools.js";

const figure = (text: string, unit = "cents"): Figure => ({ text, unit, certainty: "measured" });

test("provider decimals retain values above the floating point range and reject unsupported precision", () => {
  expect(parseProviderDecimal("9007199254740993.000000000000000001", "tokens")).toEqual({
    outcome: "valid",
    quantity: { value: 9007199254740993000000000000000001n, scale: 18, unit: "tokens" },
  });
  for (const value of ["-1", "1e3", "NaN", "1.00001", "922337203685477.5808"])
    expect(parseProviderDecimal(value, "cents").outcome).toBe("invalid");
  expect(parseProviderDecimal("1.5", "requests", 0).outcome).toBe("invalid");
  expect(parseProviderDecimal("922337203685477.5807", "cents").outcome).toBe("valid");
});

test("availability limits respect the host's reservation basis and never merge funding units", () => {
  const input = {
    used: figure("123.4567"),
    reserved: figure("2.0001"),
    available: figure("8.0002"),
  };
  expect(
    allocationLimitFromAvailable({ ...input, availabilityBasis: "before_reservations" }),
  ).toEqual({
    outcome: "ready",
    limit: { text: "131.4569", unit: "cents", certainty: "measured" },
  });
  expect(
    allocationLimitFromAvailable({ ...input, availabilityBasis: "after_reservations" }),
  ).toEqual({ outcome: "ready", limit: { text: "133.457", unit: "cents", certainty: "measured" } });
  expect(
    allocationLimitFromAvailable({
      ...input,
      available: figure("8", "customer_cents"),
      availabilityBasis: "before_reservations",
    }).outcome,
  ).toBe("unavailable");
  expect(
    allocationLimitFromAvailable({
      ...input,
      used: { text: "", unit: "cents", certainty: "unknown" },
      availabilityBasis: "before_reservations",
    }).outcome,
  ).toBe("unavailable");
  expect(
    allocationLimitFromAvailable({
      ...input,
      available: "unavailable",
      availabilityBasis: "before_reservations",
    }).outcome,
  ).toBe("unavailable");
  expect(
    allocationLimitFromAvailable({
      ...input,
      available: figure("922337203685477.5807"),
      availabilityBasis: "after_reservations",
    }).outcome,
  ).toBe("unavailable");
});

const projection = {
  used: figure("10"),
  reserved: figure("5"),
  limit: figure("25"),
  periodStart: "2026-10-01T00:00:00.000Z",
  asOf: "2026-10-02T00:00:00.000Z",
  periodEnd: "2026-11-01T00:00:00.000Z",
};

test("projection distinguishes settled pace, reservation headroom and reset boundaries", () => {
  expect(projectBudgetExhaustion(projection)).toEqual({
    kind: "estimated",
    at: "2026-10-03T00:00:00.000Z",
    basis: "observed_average",
  });
  expect(projectBudgetExhaustion({ ...projection, used: figure("0") })).toEqual({
    kind: "no_usage",
  });
  expect(projectBudgetExhaustion({ ...projection, reserved: figure("15") })).toEqual({
    kind: "exhausted",
    at: projection.asOf,
  });
  expect(projectBudgetExhaustion({ ...projection, limit: figure("315") })).toEqual({
    kind: "within_limits",
  });
  expect(projectBudgetExhaustion({ ...projection, used: "unavailable" }).kind).toBe("unavailable");
  expect(
    projectBudgetExhaustion({ ...projection, reserved: figure("5", "customer_cents") }).kind,
  ).toBe("unavailable");
  expect(projectBudgetExhaustion({ ...projection, asOf: projection.periodStart }).kind).toBe(
    "unavailable",
  );
  expect(projectBudgetExhaustion({ ...projection, periodEnd: "bad" }).kind).toBe("unavailable");
});

test("projection is exact above Number.MAX_SAFE_INTEGER and rounds time conservatively", () => {
  const large = (text: string) => figure(text, "tokens");
  expect(
    projectBudgetExhaustion({
      ...projection,
      used: large("9007199254740993"),
      reserved: large("0"),
      limit: large("18014398509481986"),
    }),
  ).toMatchObject({ kind: "estimated", at: "2026-10-03T00:00:00.000Z" });
  expect(
    projectBudgetExhaustion({
      ...projection,
      used: large("3"),
      reserved: large("0"),
      limit: large("4"),
      periodStart: "2026-10-01T00:00:00.000Z",
      asOf: "2026-10-01T00:00:00.001Z",
    }),
  ).toMatchObject({ kind: "estimated", at: "2026-10-01T00:00:00.002Z" });
});
