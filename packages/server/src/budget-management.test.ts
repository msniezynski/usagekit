import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeMeterJson } from "@usagekit/core";
import type { Budget } from "@usagekit/core";
import type { BudgetWriter } from "@usagekit/react";
import { encodeWire } from "@usagekit/http";
import { startServer } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-budget-management-"));
  dirs.push(dir);
  return dir;
};
const budget: Budget = {
  id: "monthly",
  version: 1,
  scope: { kind: "principal", namespace: "local", principal: "local" },
  surface: "any",
  unit: "requests",
  limit: { unit: "requests", value: 9007199254740993n, scale: 0 },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
};
const client = async () =>
  (await import(
    /* @vite-ignore */ pathToFileURL(join(import.meta.dirname, "../ui/app/management-client.ts"))
      .href
  )) as {
    createBudgetWriter(session: {
      baseUrl: string;
      token: string;
      fetch: typeof globalThis.fetch;
    }): BudgetWriter;
  };

test("a lost budget response reconciles the immutable original version after later edits and restart", async () => {
  const dir = directory();
  let token = "";
  let server = await startServer({ configDir: dir, port: 0, onToken: (value) => (token = value) });
  let saves = 0;
  const transport: typeof fetch = async (url, init) => {
    const response = await server.app.request(String(url), init);
    if (init?.method === "PUT" && ++saves === 1) throw new Error("credential-marker-in-error");
    return response;
  };
  const { createBudgetWriter } = await client();
  const writer = createBudgetWriter({ baseUrl: "http://local.test", token, fetch: transport });
  try {
    expect(await writer.save(budget)).toEqual({
      outcome: "unavailable",
      message: "The budget result is unknown. Check its status before another change.",
      ambiguous: true,
    });
    const later = { ...budget, version: 2, limit: { ...budget.limit!, value: 5n } };
    expect(await writer.save(later)).toEqual({ outcome: "saved", budget: later });
    await server.stop();
    server = await startServer({ configDir: dir, port: 0, onToken: () => {} });
    expect(await writer.reconcile!(budget)).toEqual({ outcome: "saved", budget });
    expect(server.store.listBudgets()).toEqual([later]);
    expect(saves).toBe(2);
    expect(await writer.reconcile!({ ...budget, limit: { ...budget.limit!, value: 4n } })).toEqual({
      outcome: "conflict",
      reason: "budget_version",
    });
    // An absent version has no immutable proof: it cannot unlock an unknown mutation.
    expect(await writer.reconcile!({ ...budget, version: 3 })).toMatchObject({
      outcome: "unavailable",
      ambiguous: true,
    });
    expect(server.store.listBudgets()).toEqual([later]);
  } finally {
    await server.stop();
  }
});

test("budget reconciliation authenticates and validates namespace without accepting caller identity", async () => {
  let token = "";
  const server = await startServer({
    configDir: directory(),
    port: 0,
    onToken: (value) => (token = value),
  });
  const send = (body: string, bearer = token) =>
    server.app.request("/budgets/reconcile", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body,
    });
  try {
    expect((await send(encodeWire(budget), "wrong")).status).toBe(401);
    expect((await send("{")).status).toBe(400);
    expect(
      (await send(encodeWire({ ...budget, scope: { ...budget.scope, namespace: "other" } })))
        .status,
    ).toBe(403);
    expect((await send(encodeWire({ ...budget, canManageBudgets: true }))).status).toBe(400);
    const absent = await send(encodeWire(budget));
    expect(absent.status).toBe(200);
    expect(decodeMeterJson(await absent.text())).toMatchObject({
      outcome: "unavailable",
      ambiguous: true,
    });
    expect(server.store.listBudgets()).toEqual([]);
  } finally {
    await server.stop();
  }
});
