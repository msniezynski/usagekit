import { describe, expect, test } from "vitest";
import { createCatalog, loadFixtures, missingFixtures, verifyFixture } from "./index.js";
import { exampleDescriptor, exampleExtractors, runDescriptorConformance } from "./testing/index.js";

const files = import.meta.glob("./example-fixtures/**/*.json", { eager: true, import: "default" });

runDescriptorConformance(exampleDescriptor, exampleExtractors, files);

describe("fixture harness", () => {
  const fixtures = loadFixtures(files);
  const catalog = createCatalog({
    providers: [{ descriptor: exampleDescriptor, extractors: exampleExtractors }],
    enabled: ["example"],
  });

  test("the loader reads provider, operation, origin and bigint expectations", () => {
    const search = fixtures.find((f) => f.path.endsWith("search/billed-high-priority.json"))!;
    expect(search).toMatchObject({
      provider: "example",
      operation: "search",
      origin: "synthetic",
      request: { method: "GET" },
      response: { status: 200 },
    });
    expect(search.expect.receipt?.cost).toEqual({
      certainty: "measured",
      money: { units: 20000n, currency: "USD" },
    });
  });

  test("a missing fixture for an advertised operation is reported", () => {
    expect(missingFixtures(exampleDescriptor, fixtures)).toEqual([]);
    expect(
      missingFixtures(
        exampleDescriptor,
        fixtures.filter((f) => f.operation !== "files"),
      ),
    ).toEqual(["files"]);
  });

  test("a fixture whose request matches another operation or whose receipt differs fails", () => {
    const search = fixtures.find((f) => f.operation === "search")!;
    expect(verifyFixture(catalog, { ...search, operation: "items.get" })).toContain(
      "matched search, expected items.get",
    );
    expect(
      verifyFixture(catalog, {
        ...search,
        expect: { ...search.expect, receipt: { ...search.expect.receipt!, failed: true } },
      }),
    ).toContain("receipt differs");
    expect(
      verifyFixture(catalog, { ...search, expect: { ...search.expect, options: { a: "b" } } }),
    ).toContain("options differ");
    expect(verifyFixture(catalog, { ...search, expect: { requestId: "other" } })).toEqual([
      "request id differs",
    ]);
    const account = fixtures.find((f) => f.operation === "account")!;
    expect(verifyFixture(catalog, { ...account, expect: { balance: { plan: "other" } } })).toEqual([
      "balance differs",
    ]);
    expect(verifyFixture(catalog, { ...account, expect: {} })).toEqual([
      "fixture declares no expectation",
    ]);
    expect(
      verifyFixture(catalog, {
        ...account,
        expect: { priceList: { checkedAt: "2026-09-25", rows: [] } },
      }),
    ).toEqual(["no price list parser"]);
    expect(verifyFixture(catalog, { ...account, expect: { billingLines: [] } })).toEqual([
      "no billing export parser",
    ]);
  });

  test("the loader rejects malformed fixture files", () => {
    const base = files["./example-fixtures/account/basic.json"] as Record<string, unknown>;
    expect(() => loadFixtures({ "./x/account/a.json": { ...base, origin: "guessed" } })).toThrow(
      "InvalidFixture: ./x/account/a.json: origin",
    );
    expect(() => loadFixtures({ "./x/search/a.json": base })).toThrow(
      "InvalidFixture: ./x/search/a.json: operation folder",
    );
    expect(() => loadFixtures({ "./x/account/a.json": { ...base, request: null } })).toThrow(
      "InvalidFixture: ./x/account/a.json: request",
    );
    expect(() => loadFixtures({ "./x/account/a.json": { ...base, response: {} } })).toThrow(
      "InvalidFixture: ./x/account/a.json: response",
    );
    expect(() => loadFixtures({ "a.json": base })).toThrow("InvalidFixture: a.json: path");
    expect(() => loadFixtures({ "./x/account/a.json": "text" })).toThrow(
      "InvalidFixture: ./x/account/a.json: object",
    );
  });
});
