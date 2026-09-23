import { expect, test } from "vitest";
import { Hono } from "hono";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { createUsageHandlers } from "@usagekit/http";
import type { AccessContext } from "@usagekit/core";
import { createRemoteMeter, RemoteUnavailable } from "./index.js";
const access: AccessContext = {
  namespace: "test",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
};
test("lost response replays same command without double effect", async () => {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: [] }),
    meter = createMeter({ store, clock }),
    app = new Hono();
  const handler = createUsageHandlers({ meter, authenticate: async () => access });
  app.all("*", (c) => handler(c.req.raw));
  let drop = false;
  const remote = createRemoteMeter({
    baseUrl: "http://local.test",
    token: "local-token",
    fetch: async (i, init) => {
      const h = new Headers(init?.headers);
      expect(h.get("Authorization")).toBe("Bearer local-token");
      expect(h.has("namespace")).toBe(false);
      expect(h.has("principal")).toBe(false);
      const res = await app.request(i, init);
      if (drop) {
        drop = false;
        throw new Error("lost response");
      }
      return res;
    },
  });
  const r = await remote.reserve({
    operationId: "op",
    scope: { namespace: "test", principal: "u", connection: "c" },
    fundingSource: "byok",
    costOwner: "u",
    surface: "app",
    source: "app",
    provider: "example",
    operation: "search",
    estimate: [],
  });
  if (r.outcome !== "reserved") throw new Error("fixture");
  const command = {
    namespace: "test",
    principal: "u",
    operationId: "op",
    commandId: "release-stable",
    expectedVersion: 1,
    reason: "cancel",
  };
  drop = true;
  await expect(remote.releaseUndispatched(command)).rejects.toMatchObject({
    name: "RemoteUnavailable",
    requestId: "release-stable",
  });
  expect(await remote.releaseUndispatched(command)).toMatchObject({
    outcome: "released",
    replayed: true,
    operation: { version: 2 },
  });
});
test("network, non-JSON and unexpected server failures remain exceptions", async () => {
  for (const fetcher of [
    async () => {
      throw new Error("secret internal detail");
    },
    async () => new Response("not json"),
    async () => new Response("bad", { status: 500 }),
  ]) {
    const remote = createRemoteMeter({
      baseUrl: "http://local.test",
      token: "token",
      fetch: fetcher,
    });
    await expect(
      remote.usage(access, {
        scope: { kind: "namespace", namespace: "test" },
        from: "2026-09-01T00:00:00Z",
        to: "2026-10-01T00:00:00Z",
        units: [],
        groupBy: [],
      }),
    ).rejects.toBeInstanceOf(RemoteUnavailable);
  }
});

test("read forbidden stays typed; authentication failures and bad wire bodies are explicit", async () => {
  const q = {
    scope: { kind: "namespace" as const, namespace: "test" },
    from: "2026-09-01T00:00:00Z",
    to: "2026-10-01T00:00:00Z",
    units: [],
    groupBy: [],
  };
  const client = (status: number, body = "{}") =>
    createRemoteMeter({
      baseUrl: "http://local.test/",
      token: "token",
      fetch: async () => new Response(body, { status }),
    });
  expect(await client(403).usage(access, q)).toEqual({ outcome: "forbidden" });
  expect(await client(400).usage(access, q)).toMatchObject({ outcome: "invalid" });
  await expect(client(401).usage(access, q)).rejects.toMatchObject({
    name: "RemoteHttpError",
    status: 401,
  });
  await expect(client(200, "null").usage(access, q)).rejects.toBeInstanceOf(RemoteUnavailable);
});
