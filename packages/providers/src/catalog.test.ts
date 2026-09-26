import { describe, expect, test } from "vitest";
import { validateBudget } from "@usagekit/store";
import type { ProviderDescriptor, Quantity } from "@usagekit/core";
import { createCatalog, decimalQuantity, pointer, selectPriceRow } from "./index.js";
import type { CatalogConnection, ProviderRequest } from "./index.js";
import { exampleDescriptor, exampleProvider } from "./testing/index.js";

const catalog = createCatalog({
  providers: [exampleProvider],
  enabled: ["example"],
  now: () => new Date("2026-09-25T12:00:00.000Z"),
});
const get = (path: string): ProviderRequest => ({
  method: "GET",
  url: `https://api.example.com/v1${path}`,
});
const q = (value: bigint, unit: string, scale = 0): Quantity => ({ value, unit, scale });
const request = q(1n, "requests");
const operationOf = (r: ProviderRequest) => {
  const m = catalog.match("example", r);
  return m.operation === "unknown" ? "unknown" : m.operation.id;
};

describe("match", () => {
  test("the longest literal path wins over a parameter", () => {
    expect(operationOf(get("/items/special"))).toBe("items.special");
    expect(operationOf(get("/items/42"))).toBe("items.get");
  });

  test("more query constraints win at equal literal length", () => {
    expect(operationOf(get("/search?engine=images&q=x"))).toBe("search.images");
    expect(operationOf(get("/search?engine=web&q=x"))).toBe("search");
  });

  test("ANY matches every method and a trailing wildcard matches the rest", () => {
    expect(operationOf({ method: "DELETE", url: "https://api.example.com/v1/files/a/b" })).toBe(
      "files",
    );
    expect(operationOf({ method: "POST", url: "/v1/files/" })).toBe("files");
  });

  test("options come from request data through the extractor", () => {
    expect(catalog.match("example", get("/search?priority=high"))).toMatchObject({
      operation: { id: "search" },
      options: { priority: "high" },
    });
    expect(catalog.match("example", get("/search"))).toMatchObject({ options: {} });
  });

  test("unknown paths, methods, base paths and hosts are unknown", () => {
    for (const r of [
      get("/nothing"),
      { method: "POST", url: "https://api.example.com/v1/search" },
      { method: "GET", url: "https://api.example.com/search" },
      { method: "GET", url: "https://other.example.com/v1/search" },
      get("/items/42/extra"),
    ])
      expect(catalog.match("example", r)).toEqual({ operation: "unknown" });
  });

  test("a disabled or unknown provider is not matched", () => {
    const disabled = createCatalog({ providers: [exampleProvider], enabled: [] });
    expect(disabled.match("example", get("/search"))).toEqual({ operation: "unknown" });
    expect(catalog.match("missing", get("/search"))).toEqual({ operation: "unknown" });
    expect(disabled.operationsOf("example")).toEqual([]);
    expect(
      disabled.estimate({ id: "c", provider: "example", plan: "basic" }, "search", {}),
    ).toEqual({ quantities: [request], source: "unknown" });
  });
});

describe("estimate", () => {
  const connection: CatalogConnection = { id: "c1", provider: "example", plan: "basic" };
  const estimate = (c: Partial<CatalogConnection>, op = "search", options = {}) =>
    catalog.estimate({ ...connection, ...c }, op, options);

  test("manual price for the connection and operation comes first", () => {
    expect(
      estimate({
        manualPrices: { search: q(25n, "cents", 2) },
        measured: () => ({ quantity: q(9n, "cents"), samples: 50 }),
      }),
    ).toEqual({ quantities: [q(25n, "cents", 2), request], source: "manual" });
  });

  test("measured is used with at least the minimum sample, otherwise the list price", () => {
    expect(estimate({ measured: () => ({ quantity: q(3n, "units"), samples: 5 }) })).toEqual({
      quantities: [q(3n, "units"), request],
      source: "measured",
    });
    expect(estimate({ measured: () => ({ quantity: q(3n, "units"), samples: 4 }) })).toEqual({
      quantities: [q(1n, "units"), request],
      source: "list",
      priceVersion: "example:2026-01-01",
    });
  });

  test("list rows select on plan, options and overage", () => {
    expect(estimate({}, "search", { priority: "high" }).quantities[0]).toEqual(q(2n, "units"));
    expect(estimate({}, "search", { priority: "normal" }).quantities[0]).toEqual(q(1n, "units"));
    expect(estimate({ plan: "pro", overage: true }).quantities[0]).toEqual(q(5000n, "cents", 4));
    expect(estimate({ plan: "pro" }).quantities[0]).toEqual(q(1n, "units"));
    expect(estimate({ plan: "basic", overage: true })).toEqual({
      quantities: [request],
      source: "unknown",
    });
  });

  test("the latest row valid at the catalog date wins", () => {
    expect(estimate({}, "search.images")).toEqual({
      quantities: [q(30n, "cents", 2), request],
      source: "list",
      priceVersion: "example:2026-01-01",
    });
    const later = createCatalog({
      providers: [exampleProvider],
      enabled: ["example"],
      now: () => new Date("2026-10-02T00:00:00.000Z"),
    });
    expect(later.estimate(connection, "search.images", {}).quantities[0]).toEqual(
      q(40n, "cents", 2),
    );
  });

  test("a plan-priced operation without a plan on the connection is unknown", () => {
    const { plan: _, ...planless } = connection;
    expect(catalog.estimate(planless, "search", {})).toEqual({
      quantities: [request],
      source: "unknown",
    });
    expect(catalog.estimate(planless, "items.get", {}).source).toBe("list");
  });

  test("an operation without any source, a free operation and an unknown operation", () => {
    expect(estimate({}, "files")).toEqual({ quantities: [request], source: "unknown" });
    expect(estimate({}, "unknown")).toEqual({ quantities: [request], source: "unknown" });
    expect(estimate({}, "account")).toEqual({ quantities: [], source: "list" });
  });

  test("the minimum sample is a catalog setting", () => {
    const strict = createCatalog({
      providers: [exampleProvider],
      enabled: ["example"],
      measuredMinSamples: 10,
    });
    expect(
      strict.estimate(
        { ...connection, measured: () => ({ quantity: q(3n, "units"), samples: 9 }) },
        "search",
        {},
      ).source,
    ).toBe("list");
  });
});

describe("extract, probe and listings", () => {
  test("extract delegates to the descriptor's extractor", () => {
    expect(
      catalog.extract(
        "example",
        "search",
        get("/search"),
        { status: 200 },
        {
          id: "r1",
          cost_cents: "0.25",
        },
      ),
    ).toEqual({
      measurements: [{ unit: "requests", quantity: request, certainty: "measured" }],
      cost: { certainty: "measured", money: { units: 2500n, currency: "USD" } },
      providerRequestId: "r1",
      cached: false,
      failed: false,
    });
    expect(catalog.requestId("example", { id: "r2" })).toBe("r2");
  });

  test("an unknown operation yields one request with unknown cost", () => {
    expect(catalog.extract("example", "unknown", get("/x"), { status: 500 }, null)).toEqual({
      measurements: [{ unit: "requests", quantity: request, certainty: "measured" }],
      cost: { certainty: "unknown", money: null },
      cached: false,
      failed: true,
    });
    expect(() => catalog.extract("missing", "search", get("/x"), { status: 200 }, {})).toThrow(
      "ProviderDisabled",
    );
  });

  test("probe reads the declared JSON pointers without an extractor override", () => {
    expect(
      catalog.probe("example", {
        searches_left: 120,
        searches_per_month: 1000,
        used: 880,
        renews_on: "2026-10-12",
        plan: "basic",
        email: "owner@example.com",
        hourly_limit: 200,
      }),
    ).toEqual({
      remaining: q(120n, "units"),
      allowance: q(1000n, "units"),
      used: q(880n, "units"),
      resetsAt: "2026-10-12T00:00:00.000Z",
      plan: "basic",
      accountIdentity: "owner@example.com",
      rateLimitPerHour: 200,
    });
    expect(catalog.probe("example", { searches_left: "n/a", renews_on: null })).toEqual({});
  });

  test("probe prefers the extractor and fails without a probe", () => {
    const custom = createCatalog({
      providers: [
        {
          descriptor: exampleDescriptor,
          extractors: { ...exampleProvider.extractors, balance: () => ({ plan: "x" }) },
        },
        {
          descriptor: { ...exampleDescriptor, id: "bare" },
          extractors: exampleProvider.extractors,
        },
      ].map((p, n) =>
        n === 1
          ? {
              ...p,
              descriptor: (({ balance: _, ...rest }) => rest)(p.descriptor) as ProviderDescriptor,
            }
          : p,
      ),
      enabled: ["example", "bare"],
    });
    expect(custom.probe("example", {})).toEqual({ plan: "x" });
    expect(() => custom.probe("bare", {})).toThrow("NoBalanceProbe");
  });

  test("operationsOf and plansOf list the descriptor data", () => {
    expect(catalog.operationsOf("example").map((o) => o.id)).toEqual([
      "search",
      "search.images",
      "items.get",
      "items.special",
      "files",
      "account",
    ]);
    expect(catalog.plansOf("example").map((p) => p.id)).toEqual(["basic", "pro", "credits"]);
    expect(catalog.plansOf("missing")).toEqual([]);
    expect(catalog.providers().map((d) => d.id)).toEqual(["example"]);
  });
});

describe("proposeBudget", () => {
  const target = { namespace: "local", connection: "c1", now: new Date("2026-09-25T12:00:00Z") };

  test("a hard monthly plan proposes a blocking connection budget on the probe's cycle", () => {
    const b = catalog.proposeBudget("example", "basic", {
      ...target,
      probe: { resetsAt: "2026-10-12T00:00:00.000Z" },
    });
    expect(b).toEqual({
      id: "c1:plan:basic",
      version: 1,
      scope: { kind: "connection", namespace: "local", connection: "c1" },
      surface: "any",
      unit: "units",
      limit: q(1000n, "units"),
      window: {
        kind: "provider_cycle",
        cycleId: "basic:2026-09-12",
        startsAt: "2026-09-12T00:00:00.000Z",
        endsAt: "2026-10-12T00:00:00.000Z",
      },
      onExceed: "block",
      alerts: [{ at: { percent: 80 } }],
    });
    expect(() => validateBudget(b)).not.toThrow();
  });

  test("a soft plan allows past the allowance with a proposed hard cap", () => {
    const b = catalog.proposeBudget("example", "pro", target);
    expect(b).toMatchObject({
      onExceed: "allow",
      limit: q(5000n, "units"),
      hardLimit: q(10000n, "units"),
      window: {
        kind: "provider_cycle",
        cycleId: "pro:2026-09-25",
        startsAt: "2026-09-25T00:00:00.000Z",
        endsAt: "2026-10-25T00:00:00.000Z",
      },
    });
    expect(() => validateBudget(b)).not.toThrow();
  });

  test("a prepaid plan bounds the probed remaining balance since the proposal", () => {
    const b = catalog.proposeBudget("example", "credits", {
      ...target,
      probe: { remaining: q(250n, "units") },
    });
    expect(b).toMatchObject({
      unit: "units",
      limit: q(250n, "units"),
      onExceed: "block",
      window: {
        kind: "since_reset",
        epoch: "credits:2026-09-25",
        startsAt: "2026-09-25T12:00:00.000Z",
      },
    });
    expect(() => validateBudget(b)).not.toThrow();
    const unbounded = catalog.proposeBudget("example", "credits", target);
    expect(unbounded).toMatchObject({ limit: null, unit: "units" });
    expect(unbounded).not.toHaveProperty("alerts");
    expect(() => validateBudget(unbounded)).not.toThrow();
  });

  test("an unknown plan is refused", () => {
    expect(() => catalog.proposeBudget("example", "gold", target)).toThrow("UnknownPlan");
  });
});

describe("catalog construction and helpers", () => {
  test("a descriptor with problems or an unknown enabled id is refused", () => {
    expect(() =>
      createCatalog({
        providers: [
          {
            descriptor: { ...exampleDescriptor, operations: [] },
            extractors: exampleProvider.extractors,
          },
        ],
        enabled: [],
      }),
    ).toThrow("InvalidDescriptor: example: unknown_price_operation");
    expect(() => createCatalog({ providers: [exampleProvider], enabled: ["nope"] })).toThrow(
      "UnknownProvider: nope",
    );
    expect(() =>
      createCatalog({ providers: [exampleProvider, exampleProvider], enabled: [] }),
    ).toThrow("DuplicateProvider: example");
  });

  test("decimal quantities and JSON pointers are exact", () => {
    expect(decimalQuantity("0.0150", "cents")).toEqual(q(150n, "cents", 4));
    expect(decimalQuantity("12", "units")).toEqual(q(12n, "units"));
    expect(() => decimalQuantity("1e3", "units")).toThrow("InvalidDecimal");
    const body = { a: [{ "b/c": { "d~e": 1 } }] };
    expect(pointer(body, "/a/0/b~1c/d~0e")).toBe(1);
    expect(pointer(body, "")).toBe(body);
    expect(pointer(body, "/a/5/x")).toBeUndefined();
    expect(pointer(null, "/a")).toBeUndefined();
  });

  test("selectPriceRow returns the row behind a list estimate", () => {
    expect(
      selectPriceRow({
        operation: exampleDescriptor.operations[0]!,
        options: { priority: "high" },
        plan: "basic",
        prices: [...exampleDescriptor.prices],
      }),
    ).toMatchObject({ perUnit: "2", option: { priority: "high" } });
  });
});
