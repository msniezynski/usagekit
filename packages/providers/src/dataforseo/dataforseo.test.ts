import { describe, expect, test } from "vitest";
import { createCatalog, loadFixtures } from "../index.js";
import { dataforseo } from "../index.js";
import { runDescriptorConformance } from "../testing/index.js";

const files = import.meta.glob("./fixtures/**/*.json", { eager: true, import: "default" });
runDescriptorConformance(dataforseo.descriptor, dataforseo.extractors, files);

describe("provider A (dataforseo)", () => {
  const catalog = createCatalog({
    providers: [dataforseo],
    enabled: ["dataforseo"],
    now: () => new Date("2026-09-25T12:00:00.000Z"),
  });
  const connection = { id: "c1", provider: "dataforseo", plan: "prepaid" };

  test("one prepaid hard plan, basic auth, per-request billing export by task id", () => {
    const d = dataforseo.descriptor;
    expect(d.auth).toEqual({ kind: "basic" });
    expect(d.plans).toEqual([
      { id: "prepaid", label: "Prepaid balance", cycle: "prepaid", allowanceMode: "hard" },
    ]);
    expect(d.billingExport).toMatchObject({
      kind: "task-history",
      granularity: "per-request",
      matchKey: "providerRequestId",
    });
    expect(d.operations.filter((o) => !o.billable).map((o) => o.id)).toEqual([
      "serp.google.organic.tasks_ready",
      "serp.google.organic.task_get.advanced",
      "appendix.user_data",
      "dataforseo_labs.status",
    ]);
    expect(d.operations.find((o) => o.id === "serp.google.organic.task_post")?.costEvidence).toBe(
      "deferred",
    );
  });

  test("list estimates in cents per call, priority from the request body", () => {
    expect(catalog.estimate(connection, "serp.google.organic.live.advanced", {})).toEqual({
      quantities: [
        { value: 2n, scale: 1, unit: "cents" },
        { value: 1n, scale: 0, unit: "requests" },
      ],
      source: "list",
      priceVersion: "dataforseo:2026-09-25",
    });
    const post = (priority?: number) =>
      catalog.match("dataforseo", {
        method: "POST",
        url: "https://api.dataforseo.com/v3/serp/google/organic/task_post",
        body: [{ keyword: "x", ...(priority ? { priority } : {}) }],
      });
    const high = post(2);
    if (high.operation === "unknown") throw new Error("fixture");
    expect(catalog.estimate(connection, high.operation.id, high.options).quantities[0]).toEqual({
      value: 12n,
      scale: 2,
      unit: "cents",
    });
    expect(post(1)).toMatchObject({ options: { priority: "normal" } });
    expect(post(7)).toMatchObject({ options: {} });
    expect(
      catalog.match("dataforseo", {
        method: "POST",
        url: "https://api.dataforseo.com/v3/serp/google/organic/task_post",
        body: "not json",
      }),
    ).toMatchObject({ options: {} });
  });

  test("a price row for every billable operation", () => {
    for (const op of dataforseo.descriptor.operations.filter((o) => o.billable))
      expect(catalog.estimate(connection, op.id, { priority: "normal" }).source).toBe("list");
  });

  test("the price list parser refreshes the static rows except their source", () => {
    const fixture = loadFixtures(files).find((f) => f.operation === "appendix.user_data")!;
    const parsed = dataforseo.extractors.priceList!(fixture.response.body, "2026-09-25");
    const strip = (rows: readonly { source: string }[]) =>
      rows.map(({ source: _, ...rest }) => rest);
    expect(strip(parsed)).toEqual(strip(dataforseo.descriptor.prices));
    expect(dataforseo.extractors.priceList!({}, "2026-09-25")).toEqual([]);
  });

  test("a transport-level failure is a failed receipt with its reported cost", () => {
    const failed = catalog.extract(
      "dataforseo",
      "serp.google.organic.live.advanced",
      { method: "POST", url: "https://api.dataforseo.com/v3/serp/google/organic/live/advanced" },
      { status: 401 },
      { status_code: 40100, status_message: "You are not authorized.", cost: 0, tasks: [] },
    );
    expect(failed).toMatchObject({ failed: true, cost: { certainty: "measured" } });
    expect(
      catalog.extract(
        "dataforseo",
        "serp.google.organic.live.advanced",
        { method: "POST", url: "https://api.dataforseo.com/v3/serp/google/organic/live/advanced" },
        { status: 502 },
        "Bad gateway",
      ),
    ).toMatchObject({ failed: true, cost: { certainty: "unknown", money: null } });
    expect(dataforseo.extractors.requestId(null)).toBeUndefined();
    expect(dataforseo.extractors.billingExport!({ tasks: [{ id: "x" }] })).toEqual([]);
    expect(dataforseo.extractors.balance!({})).toEqual({ plan: "prepaid" });
  });
});
