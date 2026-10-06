import { expect, test, vi } from "vitest";
import { dataforseo, serpapi, parseBillingExport } from "./index.js";
import fixture from "./dataforseo/fixtures/serp.google.organic.task_get.advanced/resolves-task-post.json" with { type: "json" };

test("task-history parsing keeps exact charges and hashes the original bytes", async () => {
  const original = JSON.stringify(fixture.response.body);
  const parsed = await parseBillingExport(dataforseo, original);
  expect(parsed.provider).toBe("dataforseo");
  expect(parsed.lines).toEqual([
    {
      providerRequestId: "09251220-1535-0066-0000-8f0635c0dc89",
      operation: "serp.google.organic.task_post",
      occurredAt: "2026-09-25T12:24:40.000Z",
      cost: { units: 1200n, currency: "USD" },
    },
  ]);
  expect(parsed.fileHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await parseBillingExport(dataforseo, original)).toEqual(parsed);
  const whitespace = await parseBillingExport(dataforseo, original + "\n");
  expect(whitespace.lines).toEqual(parsed.lines);
  expect(whitespace.fileHash).not.toBe(parsed.fileHash);
});

test("the hash is SHA-256 of the original UTF-8 export, including non-ASCII text", async () => {
  const module = {
    ...dataforseo,
    extractors: { ...dataforseo.extractors, billingExport: vi.fn(() => []) },
  };
  const original = '{"tasks":[],"label":"Łódź 🦊"}';
  const parsed = await parseBillingExport(module, original);
  const expected = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(original)),
  );
  expect(parsed.fileHash).toBe([...expected].map((b) => b.toString(16).padStart(2, "0")).join(""));
  expect(module.extractors.billingExport).toHaveBeenCalledWith({ tasks: [], label: "Łódź 🦊" });
});

test("unsupported exports never invoke a supplied parser or claim CSV support", async () => {
  const parser = vi.fn(() => []);
  await expect(
    parseBillingExport(
      { ...serpapi, extractors: { ...serpapi.extractors, billingExport: parser } },
      "invoice.csv",
    ),
  ).rejects.toThrow("Billing export is unavailable for serpapi");
  expect(parser).not.toHaveBeenCalled();
  const { billingExport: _omitted, ...withoutExport } = dataforseo.extractors;
  await expect(
    parseBillingExport({ ...dataforseo, extractors: withoutExport }, "{}"),
  ).rejects.toThrow("Billing export is unavailable for dataforseo");
});

test("malformed and partially unreadable history cannot become an empty or partial import", async () => {
  for (const original of ["invoice.csv", "{}", '{"tasks":[{"id":"missing-cost"}]}'])
    await expect(parseBillingExport(dataforseo, original)).rejects.toThrow();
  await expect(
    parseBillingExport(
      dataforseo,
      JSON.stringify({
        ...fixture.response.body,
        tasks: [...fixture.response.body.tasks, { id: "bad" }],
      }),
    ),
  ).rejects.toThrow("Invalid task-history");
  expect((await parseBillingExport(dataforseo, '{"tasks":[]}')).lines).toEqual([]);
});

test("sub-unit and out-of-range raw numeric costs are rejected without rounding", async () => {
  for (const cost of ["0.0000001", "1.0000000000000001", "9007199254740993"])
    await expect(
      parseBillingExport(
        dataforseo,
        `{"tasks":[{"id":"exact-cost","cost":${cost},"result":[{"datetime":"2026-09-25 12:24:40 +00:00"}]}]}`,
      ),
    ).rejects.toThrow("Invalid task-history billing cost");
});

test("exact task-history costs accept zero, trailing zeros and decimal exponent notation", async () => {
  for (const [cost, units] of [
    ["0", 0n],
    ["0.0012000", 1200n],
    ["1.2e-3", 1200n],
  ] as const) {
    const parsed = await parseBillingExport(
      dataforseo,
      `{"tasks":[{"id":"exact-cost","cost":${cost},"result":[{"datetime":"2026-09-25 12:24:40 +00:00"}]}]}`,
    );
    expect(parsed.lines[0]?.cost.units).toBe(units);
  }
});

test("representable large raw USD costs retain exact money beyond binary integer precision", async () => {
  for (const [cost, units] of [
    ["9007199254740.993", 9007199254740993000n],
    ["9223372036854.775807", 2n ** 63n - 1n],
  ] as const) {
    const original = `{"tasks":[{"id":"large-cost","cost":${cost},"result":[{"datetime":"2026-09-25 12:24:40 +00:00"}]}]}`;
    expect(dataforseo.extractors.billingExport!(JSON.parse(original))[0]?.cost.units).not.toBe(
      units,
    );
    const parsed = await parseBillingExport(dataforseo, original);
    expect(parsed.lines[0]?.cost.units).toBe(units);
  }
});

test("exact costs are associated by task identity even when the descriptor reorders its lines", async () => {
  const module = {
    ...dataforseo,
    extractors: {
      ...dataforseo.extractors,
      billingExport: (body: unknown) => dataforseo.extractors.billingExport!(body).reverse(),
    },
  };
  const original =
    '{"tasks":[{"id":"large","cost":9007199254740.993,"result":[{"datetime":"2026-09-25 12:24:40 +00:00"}]},{"id":"small","cost":0.0012,"result":[{"datetime":"2026-09-25 12:24:40 +00:00"}]}]}';
  const parsed = await parseBillingExport(module, original);
  expect(
    parsed.lines.map(({ providerRequestId, cost }) => [providerRequestId, cost.units]),
  ).toEqual([
    ["small", 1200n],
    ["large", 9007199254740993000n],
  ]);
  await expect(
    parseBillingExport(
      {
        ...module,
        extractors: {
          ...module.extractors,
          billingExport: (body: unknown) =>
            module.extractors
              .billingExport(body)
              .map((line) => ({ ...line, providerRequestId: "invented" })),
        },
      },
      original,
    ),
  ).rejects.toThrow("Invalid task-history billing identity");
  const duplicated = original.replace('"id":"small"', '"id":"large"');
  await expect(parseBillingExport(dataforseo, duplicated)).rejects.toThrow(
    "Invalid task-history billing cost",
  );
});
