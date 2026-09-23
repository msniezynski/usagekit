import { beforeEach, expect, test, vi } from "vitest";
import { Hono } from "hono";
import { createMemoryStore, createManualClock } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import type { AccessContext } from "@usagekit/core";
import { createUsageHandlers, encodeWire, decodeWire } from "./index.js";
const access: AccessContext = {
  namespace: "test",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
};
const scope = { namespace: "test", principal: "u", connection: "c" };
const reserve = {
  operationId: "op",
  scope,
  fundingSource: "byok",
  costOwner: "u",
  surface: "app",
  source: "app",
  provider: "example",
  operation: "search",
  estimate: [{ unit: "requests", value: "1", scale: 0 }],
  commandId: "reserve",
};
const command = {
  namespace: "test",
  principal: "u",
  operationId: "op",
  commandId: "cmd",
  expectedVersion: 1,
};
const receipt = {
  id: "r",
  evidenceRef: "",
  measurements: [
    {
      unit: "requests",
      quantity: { unit: "requests", value: "1", scale: 18 },
      certainty: "measured",
    },
  ],
  cost: { certainty: "measured", money: { currency: "USD", units: (2n ** 63n - 1n).toString() } },
  occurredAt: "2026-09-23T12:00:00Z",
  recordedAt: "2026-09-23T12:00:00Z",
  cached: false,
  failed: false,
};
const query = {
  scope: { kind: "principal", namespace: "test", principal: "u" },
  from: "2026-09-01T00:00:00Z",
  to: "2026-10-01T00:00:00Z",
  units: ["requests"],
  groupBy: ["provider"],
};
const routes = [
  ["/v1/operations/expire", { namespace: "test", commandId: "expire", limit: 100 }],
  ["/v1/operations/reserve", reserve],
  ["/v1/operations/intent", { ...command, holder: "h", leaseTtlMs: 1000 }],
  [
    "/v1/operations/renew",
    {
      namespace: "test",
      principal: "u",
      operationId: "op",
      commandId: "renew",
      leaseId: "l",
      leaseTtlMs: 1000,
    },
  ],
  [
    "/v1/operations/claim",
    {
      namespace: "test",
      principal: "u",
      operationId: "op",
      commandId: "claim",
      holder: "h",
      leaseTtlMs: 1000,
    },
  ],
  ["/v1/operations/settle", { ...command, authority: { kind: "lease", leaseId: "l" }, receipt }],
  [
    "/v1/operations/correct",
    {
      ...command,
      authority: { kind: "late_evidence", source: "provider" },
      receipt,
      replacesReceiptId: "old",
      reason: "adjustment",
    },
  ],
  ["/v1/operations/release", { ...command, reason: "cancel" }],
  ["/v1/usage/query", query],
] as const;
let app: Hono, meter: ReturnType<typeof createMeter>;
beforeEach(() => {
  const clock = createManualClock();
  meter = createMeter({ clock, store: createMemoryStore({ clock, budgets: [] }) });
  const handlers = createUsageHandlers({
    meter,
    authenticate: async (r) => (r.headers.get("Authorization") === "Bearer valid" ? access : null),
  });
  app = new Hono();
  app.all("*", (c) => handlers(c.req.raw));
});
const post = (path: string, body: unknown, token = "valid") =>
  app.request(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test.each(routes)("POST %s validates, authenticates and scopes", async (path, body) => {
  expect((await post(path, body)).status).toBe(200);
  expect((await post(path, {})).status).toBe(400);
  expect((await post(path, body, "missing")).status).toBe(401);
  const bad =
    "scope" in body
      ? { ...body, scope: { ...body.scope, namespace: "other" } }
      : { ...body, namespace: "other" };
  expect((await post(path, bad)).status).toBe(403);
});
const b64 = (v: unknown) =>
  btoa(JSON.stringify(v)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
test.each([
  ["/v1/usage", query],
  ["/v1/budgets/defined", { scope: { kind: "principal", namespace: "test", principal: "u" } }],
  ["/v1/budgets/applicable", { scope, surface: "app", units: ["requests"] }],
  ["/v1/operations/op", { namespace: "test", principal: "u", operationId: "op" }],
])("GET %s validates, authenticates and scopes", async (path, body) => {
  const get = (q: unknown, token = "valid") =>
    app.request(`${path}?q=${b64(q)}`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await get(body)).status).toBe(200);
  expect((await get({})).status).toBe(400);
  expect((await get(body, "missing")).status).toBe(401);
  const b = body as Record<string, any>;
  expect(
    (
      await get(
        b.scope
          ? { ...b, scope: { ...b.scope, namespace: "other" } }
          : { ...b, namespace: "other" },
      )
    ).status,
  ).toBe(403);
});
test.each(["secret", "apiKey", "authorization"])(
  "forbids unknown credential key %s",
  async (field) => {
    expect((await post("/v1/operations/reserve", { ...reserve, [field]: "redacted" })).status).toBe(
      400,
    );
    expect(
      (
        await post("/v1/operations/reserve", {
          ...reserve,
          scope: { ...scope, [field]: "redacted" },
        })
      ).status,
    ).toBe(400);
  },
);
test.each(["1.5", "1e3", 1.5])("rejects non-decimal integer wire amount", async (value) => {
  expect(
    (
      await post("/v1/operations/reserve", {
        ...reserve,
        estimate: [{ value, unit: "requests", scale: 0 }],
      })
    ).status,
  ).toBe(400);
});
test("largest cost and scale 18 round trip through handlers", async () => {
  await post("/v1/operations/reserve", reserve);
  const g = await (
    await post("/v1/operations/intent", { ...command, holder: "h", leaseTtlMs: 1000 })
  ).json();
  const settled = await post("/v1/operations/settle", {
    ...command,
    commandId: "settle",
    expectedVersion: g.operation.version,
    authority: { kind: "lease", leaseId: g.lease.leaseId },
    receipt,
  });
  expect(settled.status).toBe(200);
  const data = decodeWire(await settled.text()) as any;
  expect(data.operation.receipts[0].cost.money.units).toBe(2n ** 63n - 1n);
  expect(data.operation.receipts[0].measurements[0].quantity.scale).toBe(18);
  expect(JSON.parse(encodeWire(data)).operation.receipts[0].cost.money.units).toBe(
    receipt.cost.money.units,
  );
});
test("unexpected errors do not leak details and unknown paths return 404", async () => {
  vi.spyOn(meter, "reserve").mockRejectedValue(new Error("sensitive internal detail"));
  const r = await post("/v1/operations/reserve", reserve);
  expect(r.status).toBe(500);
  expect(await r.text()).not.toContain("sensitive");
  expect(
    (await app.request("/missing", { headers: { Authorization: "Bearer valid" } })).status,
  ).toBe(404);
});
test("malformed JSON and base64url fail without echoing input", async () => {
  expect(
    (await app.request("/v1/usage?q=%", { headers: { Authorization: "Bearer valid" } })).status,
  ).toBe(400);
  expect(
    (
      await app.request("/v1/usage/query", {
        method: "POST",
        headers: { Authorization: "Bearer valid" },
        body: "{",
      })
    ).status,
  ).toBe(400);
});

test("expiry maintenance requires budget administration, not readable principals", async () => {
  const clock = createManualClock(),
    meter = createMeter({ store: createMemoryStore({ clock, budgets: [] }), clock });
  const handler = createUsageHandlers({
    meter,
    authenticate: async () => ({ ...access, canManageBudgets: false }),
  });
  expect(
    (
      await handler(
        new Request("http://local.test/v1/operations/expire", {
          method: "POST",
          body: JSON.stringify({ namespace: "test", commandId: "expire" }),
        }),
      )
    ).status,
  ).toBe(403);
});
