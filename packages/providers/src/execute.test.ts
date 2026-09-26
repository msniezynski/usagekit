import { expect, test, vi } from "vitest";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { createCatalog, dataforseo, serpapi, executeProviderRequest } from "./index.js";

function harness(tracking?: "passthrough") {
  const clock = createManualClock("2026-09-26T12:00:00Z");
  const catalog = createCatalog({
    providers: [dataforseo, serpapi],
    enabled: ["dataforseo", "serpapi"],
    now: clock.now,
  });
  const meter = createMeter({
    store: createMemoryStore({ clock, budgets: [] }),
    clock,
    catalog,
    resolveConnection: () => ({
      provider: "dataforseo",
      plan: "prepaid",
      ...(tracking ? { tracking: { "serp.google.organic.live.advanced": tracking } } : {}),
    }),
  });
  const input = {
    operationId: "one",
    scope: { namespace: "test", principal: "u", connection: "c" },
    provider: "dataforseo",
    source: "app" as const,
    surface: "app" as const,
    fundingSource: "byok" as const,
    costOwner: "u",
  };
  const request = {
    method: "POST",
    url: "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
    body: [{ keyword: "example" }],
  };
  const dispatch = vi.fn(async () => ({
    response: { status: 200 },
    body: {
      status_code: 20000,
      cost: 0.002,
      tasks: [{ id: "task", status_code: 20000, cost: 0.002, result: [] }],
    },
  }));
  return { meter, catalog, input, request, dispatch, now: clock.now };
}
test("one parallel execution wins dispatch; later replay also cannot dispatch", async () => {
  const h = harness();
  const results = await Promise.all([executeProviderRequest(h), executeProviderRequest(h)]);
  expect(results.map((r) => r.outcome).sort()).toEqual(["completed", "not_dispatched"]);
  expect(results.find((r) => r.outcome === "completed")).toMatchObject({
    accounting: "metered",
    operation: { state: "settled" },
  });
  expect((await executeProviderRequest(h)).outcome).toBe("not_dispatched");
  expect(h.dispatch).toHaveBeenCalledTimes(1);
});
test("unknown routes and denied reservations never dispatch", async () => {
  const h = harness();
  expect(
    (await executeProviderRequest({ ...h, request: { ...h.request, url: "/unknown" } })).outcome,
  ).toBe("not_dispatched");
  expect(h.dispatch).not.toHaveBeenCalled();
  vi.spyOn(h.meter, "reserve").mockResolvedValue({
    outcome: "invalid",
    field: "estimate",
    reason: "test denial",
  });
  expect((await executeProviderRequest(h)).outcome).toBe("not_dispatched");
  expect(h.dispatch).not.toHaveBeenCalled();
});
test("passthrough and free requests dispatch once with a persistent replay guard", async () => {
  for (const free of [false, true]) {
    const h = harness("passthrough");
    if (free) h.request.url = "https://api.dataforseo.com/v3/appendix/user_data";
    if (free) h.request.method = "GET";
    expect(await executeProviderRequest(h)).toMatchObject({
      outcome: "completed",
      accounting: "passthrough",
      operation: null,
    });
    expect((await executeProviderRequest(h)).outcome).toBe("not_dispatched");
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  }
});
test("transport failure remains pending and cannot authorize a paid retry", async () => {
  const h = harness();
  h.dispatch.mockRejectedValueOnce(new Error("secret transport message"));
  expect(await executeProviderRequest(h)).toMatchObject({
    outcome: "transport_failed",
    operation: { state: "pending", receipts: [{ cost: { certainty: "unknown" } }] },
  });
  expect((await executeProviderRequest(h)).outcome).toBe("not_dispatched");
  expect(h.dispatch).toHaveBeenCalledTimes(1);
});
test("an accounting failure is distinct from a provider failure", async () => {
  const h = harness();
  vi.spyOn(h.meter, "settle").mockResolvedValue({
    outcome: "invalid",
    field: "receipt",
    reason: "test",
  });
  expect(await executeProviderRequest(h)).toMatchObject({ outcome: "accounting_failed" });
  expect(h.dispatch).toHaveBeenCalledTimes(1);
});
