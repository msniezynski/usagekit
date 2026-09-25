// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { MeterProvider } from "@usagekit/react";
import type { AccessContext, Budget, ReserveInput } from "@usagekit/core";
import { createUsageHandlers, encodeWire } from "@usagekit/http";

afterEach(cleanup);
const ui = join(import.meta.dirname, "../ui/app");
type Module = Record<string, ComponentType<Record<string, unknown>>>;
// Loaded by URL so the Node typecheck of this package does not compile the browser app.
const load = async (path: string) =>
  (await import(/* @vite-ignore */ pathToFileURL(join(ui, path)).href)) as Module;
const access: AccessContext = {
  namespace: "local",
  readablePrincipals: "*",
  readableGroups: "*",
  readablePools: "*",
  canReadBillingDetail: true,
  canManageBudgets: true,
};
const now = new Date("2026-09-23T12:00:00.000Z");
const scope = { namespace: "local", principal: "local", connection: "c1" };
const budget: Budget = {
  id: "monthly",
  version: 1,
  scope: { kind: "principal", namespace: "local", principal: "local" },
  surface: "any",
  unit: "requests",
  limit: { value: 10n, scale: 0, unit: "requests" },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
};
const input = (overrides: Partial<ReserveInput> = {}): ReserveInput => ({
  operationId: crypto.randomUUID(),
  scope,
  fundingSource: "byok",
  costOwner: "local",
  surface: "programmatic",
  source: "cli",
  provider: "search",
  operation: "query",
  estimate: [{ value: 1n, scale: 0, unit: "requests" }],
  ...overrides,
});

async function memory() {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: [budget] }),
    meter = createMeter({ store, clock });
  const op = await store.reserve(input());
  if (op.outcome !== "reserved") throw new Error("fixture");
  const ref = { namespace: "local", principal: "local", operationId: op.operation.operationId };
  const g = await store.markDispatchIntent({
    ...ref,
    commandId: "intent",
    expectedVersion: 1,
    holder: "h",
    leaseTtlMs: 60000,
  });
  if (!("granted" in g) || !g.granted) throw new Error("fixture");
  await store.settle({
    ...ref,
    commandId: "settle",
    expectedVersion: g.operation.version,
    authority: { kind: "lease", leaseId: g.lease.leaseId },
    receipt: {
      id: "r1",
      measurements: [
        {
          unit: "requests",
          quantity: { value: 2n, scale: 0, unit: "requests" },
          certainty: "measured",
        },
      ],
      cost: { certainty: "measured", money: { units: 5000n, currency: "USD" } },
      occurredAt: now.toISOString(),
      recordedAt: now.toISOString(),
      cached: false,
      failed: false,
    },
  });
  await store.reserve(input({ reservationTtlMs: 1000 }));
  clock.advance(3000);
  return meter;
}
const withMeter = async (node: ReactNode) =>
  render(createElement(MeterProvider, { meter: await memory(), access }, node));
const budgetInput = { scope, surface: "programmatic", units: ["requests"] };

describe("local server UI pages on the base registry blocks", () => {
  test("overview shows header status, coverage and the usage table", async () => {
    const { OverviewPage } = await load("pages/overview.tsx");
    await withMeter(createElement(OverviewPage!, { budgetInput, units: ["requests"], now }));
    expect(await screen.findByText("7 of 10 requests left")).toBeTruthy();
    expect(await screen.findByText("0.5000 cents")).toBeTruthy();
    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Period" })).toBeTruthy();
  });
  test("budgets page shows one card per applicable budget", async () => {
    const { BudgetsPage } = await load("pages/budgets.tsx");
    await withMeter(createElement(BudgetsPage!, { budgetInput }));
    expect(await screen.findByText("principal local")).toBeTruthy();
    expect(screen.getByText("2 requests")).toBeTruthy();
    cleanup();
    await withMeter(createElement(BudgetsPage!, { budgetInput: null }));
    expect(screen.getByText(/Add a provider connection/)).toBeTruthy();
  });
  test("exceptions page lists the expired reservation", async () => {
    const { ExceptionsPage } = await load("pages/exceptions.tsx");
    await withMeter(createElement(ExceptionsPage!, { now }));
    expect(await screen.findByText("Reservation expired")).toBeTruthy();
    expect(screen.getByText("2 s")).toBeTruthy();
  });
  test("connections page lists vault connections", async () => {
    const { ConnectionsPage } = await load("pages/connections.tsx");
    render(
      createElement(ConnectionsPage!, {
        connections: [{ id: "c1", provider: "search", fundingSource: "byok", tags: ["eu"] }],
      }),
    );
    expect(screen.getByText("c1")).toBeTruthy();
    expect(screen.getByText("Own key")).toBeTruthy();
    expect(screen.getByText("eu")).toBeTruthy();
  });
});

describe("app shell", () => {
  test("the token is asked once, kept in memory and sent as the bearer header", async () => {
    const token = "local-token";
    const meter = await memory();
    const api = createUsageHandlers({
      meter,
      authenticate: async (r) =>
        r.headers.get("Authorization") === `Bearer ${token}` ? access : null,
    });
    const seen: (string | null)[] = [];
    // The same routes the local server exposes, over a memory Meter.
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(String(url), init);
      seen.push(request.headers.get("Authorization"));
      const path = new URL(request.url).pathname;
      if (path === "/providers/connections")
        return Response.json([{ provider: "search", connectionId: "c1", tags: ["eu"] }]);
      if (path === "/budgets")
        return new Response(encodeWire([budget]), {
          headers: { "Content-Type": "application/json" },
        });
      return api(request);
    };
    const { App } = await load("App.tsx");
    render(createElement(App!, { baseUrl: "http://local.test", fetch }));
    expect(seen).toEqual([]);
    fireEvent.change(screen.getByLabelText("Server token"), { target: { value: token } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("button", { name: "Overview" })).toBeTruthy();
    expect(await screen.findByText(/of 10 requests left/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connections" }));
    expect(await screen.findByText("eu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exceptions" }));
    expect(await screen.findByRole("columnheader", { name: "Exception" })).toBeTruthy();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h === `Bearer ${token}`)).toBe(true);
    // jsdom globals; this package's Node typecheck has no DOM library.
    const browser = globalThis as unknown as {
      localStorage: { length: number };
      sessionStorage: { length: number };
      document: { cookie: string };
    };
    expect(browser.localStorage.length).toBe(0);
    expect(browser.sessionStorage.length).toBe(0);
    expect(browser.document.cookie).toBe("");
  });
});
