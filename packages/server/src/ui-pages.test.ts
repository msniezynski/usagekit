// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import { MeterProvider, ProviderManagementProvider } from "@usagekit/react";
import type {
  ProviderConnection,
  ProviderDefinition,
  ProviderManagementPort,
  ProviderCommand,
} from "@usagekit/views";
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

async function memory(definitions: Budget[] = [structuredClone(budget)]) {
  const clock = createManualClock(),
    store = createMemoryStore({ clock, budgets: definitions }),
    meter = createMeter({
      store,
      clock,
      resolveOwnership: async (scope) =>
        scope.namespace === "local"
          ? { kind: "principal", namespace: "local", principal: "local" }
          : null,
    });
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
    expect(screen.getByRole("region", { name: "Local principal budgets" })).toBeTruthy();
    expect(screen.getByText("2 requests")).toBeTruthy();
    cleanup();
    await withMeter(createElement(BudgetsPage!, { budgetInput: null }));
    expect(screen.getByText(/Add a provider connection/)).toBeTruthy();
    expect(await screen.findByRole("button", { name: /^View / })).toBeTruthy();
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
      if (path === "/providers/management/binding")
        return Response.json({
          scopeKey: "local-ui:test",
          principalKey: "local",
          authRevision: "1",
          canManage: true,
        });
      if (path === "/providers/management/read")
        return Response.json({
          outcome: "ok",
          value: {
            kind: "connections",
            state: "empty",
            problem: null,
            asOf: null,
            revision: "1",
            providers: [],
            connections: [],
          },
        });
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

function providerFixture() {
  const definition: ProviderDefinition = {
    id: "search",
    label: "Search",
    fundingSources: ["byok"],
    capabilities: ["connect", "test"],
    credentialFields: [{ name: "key", label: "API key", kind: "secret", required: true }],
  };
  const connection: ProviderConnection = {
    id: "c1",
    provider: "search",
    label: "Search local",
    revision: "1",
    fundingSource: "byok",
    enabled: true,
    priority: 0,
    fallbackChain: [],
    plan: null,
    status: { state: "connected" },
    availability: { state: "unknown" },
    freshness: { observedAt: null, stale: true, source: "host" },
    hasStoredCredentials: true,
    capabilities: ["test", "reconnect", "disconnect", "rates"],
    rates: [
      {
        id: "request",
        label: "Request",
        operation: "query",
        unit: "requests",
        priceUnit: "cents",
        price: { text: "0.6250", unit: "cents", certainty: "measured" },
        fundingSource: "byok",
        editable: true,
        provenance: {
          source: "manual",
          origin: "host",
          checkedAt: null,
          sampleSize: null,
          version: "1",
        },
      },
    ],
  };
  let revision = 1;
  let connections = [structuredClone(connection)];
  const commands: ProviderCommand[] = [];
  const secrets: Record<string, string>[] = [];
  const port: ProviderManagementPort = {
    read: vi.fn<ProviderManagementPort["read"]>(async () => ({
      outcome: "ok",
      value: {
        kind: "connections",
        state: "ok",
        problem: null,
        asOf: null,
        revision: String(revision),
        connections: structuredClone(connections),
        providers: [definition],
      },
    })),
    execute: vi.fn<ProviderManagementPort["execute"]>(async (_binding, command, ephemeral) => {
      commands.push(structuredClone(command));
      if (ephemeral) secrets.push({ ...ephemeral });
      let current =
        "connectionId" in command
          ? connections.find((value) => value.id === command.connectionId)
          : undefined;
      if (command.kind === "connect") {
        current = {
          ...structuredClone(connection),
          id: "c2",
          label: command.label ?? "Search",
          revision: String(++revision),
        };
        connections.push(current);
      } else if (current && command.kind !== "test") {
        current.revision = String(++revision);
        if (command.kind === "disconnect") {
          current.hasStoredCredentials = false;
          current.status = { state: "disconnected" };
        }
        if (command.kind === "reconnect") {
          current.hasStoredCredentials = true;
          current.status = { state: "connected" };
        }
        if (command.kind === "rates")
          current.rates = current.rates.map((rate) => ({
            ...rate,
            price: {
              text: command.rates[0]!.price ?? "0.6250",
              unit: "cents",
              certainty: "measured",
            },
          }));
      }
      return {
        outcome: "success",
        commandId: command.commandId,
        revision: String(revision),
        ...(current ? { connection: structuredClone(current) } : {}),
      };
    }),
  };
  const binding = {
    scopeKey: `local-ui:test:${crypto.randomUUID()}`,
    principalKey: "local",
    authRevision: "1",
    canManage: true,
  };
  return { port, binding, commands, secrets, definition, connection };
}
describe("shared local management flows", () => {
  test("format check, connect, reconnect, exact manual rate and disconnect use explicit host ports", async () => {
    const { ConnectionsPage } = await load("pages/connections.tsx");
    const fixture = providerFixture();
    render(
      createElement(
        ProviderManagementProvider,
        { port: fixture.port, binding: fixture.binding },
        createElement(ConnectionsPage!, { connections: [] }),
      ),
    );
    await screen.findByText("Search local");
    expect(fixture.commands).toEqual([]);
    expect(screen.queryByText("Funding source")).toBeNull();
    expect(screen.queryByText("Fallback order")).toBeNull();
    expect(screen.queryByText("Balance")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect Search" }));
    expect(screen.getByText(/Checks credential format locally/)).toBeTruthy();
    expect(screen.queryByText(/Testing makes an explicit request/)).toBeNull();
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "ephemeral-ui-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Check credential format" }));
    await waitFor(() => expect(fixture.commands).toHaveLength(1));
    expect(fixture.commands[0]).toMatchObject({ kind: "test", provider: "search" });
    expect(fixture.secrets[0]).toEqual({ key: "ephemeral-ui-key" });
    expect(JSON.stringify(fixture.commands)).not.toContain("ephemeral-ui-key");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(fixture.commands).toHaveLength(2));
    expect(fixture.commands[1]!.kind).toBe("connect");
    await screen.findByRole("button", { name: "Replace credentials" });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "ephemeral-new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace credentials" }));
    await waitFor(() => expect(fixture.commands).toHaveLength(3));
    expect(fixture.commands[2]).toMatchObject({
      kind: "reconnect",
      connectionId: "c2",
      expectedRevision: "2",
    });
    fireEvent.change(screen.getByLabelText(/Price/), { target: { value: "10.1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rate" }));
    await waitFor(() => expect(fixture.commands).toHaveLength(4));
    expect(fixture.commands[3]).toMatchObject({
      kind: "rates",
      rates: [{ rateId: "request", price: "10.1234" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(fixture.commands).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
    await waitFor(() => expect(fixture.commands).toHaveLength(5));
    expect(fixture.commands[4]!.kind).toBe("disconnect");
  });
  test("new monthly budget targets the selected second connection with an exact native scope", async () => {
    const { BudgetsPage } = await load("pages/budgets.tsx");
    const definitions = [structuredClone(budget)];
    const meter = await memory(definitions);
    const saved: Budget[] = [];
    const writer = {
      save: vi.fn(async (value: Budget) => {
        definitions.push(structuredClone(value));
        saved.push(structuredClone(value));
        return { outcome: "saved" as const, budget: value };
      }),
    };
    render(
      createElement(
        MeterProvider,
        { meter, access, budgetWriter: writer },
        createElement(BudgetsPage!, {
          connections: [
            { id: "c1", provider: "search", fundingSource: "byok" },
            { id: "c2", provider: "language", fundingSource: "byok" },
          ],
          units: ["requests", "tokens"],
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "c2" }));
    const section = screen.getByRole("region", { name: "Connection budgets" });
    fireEvent.click(await within(section).findByRole("button", { name: "Create Monthly tokens" }));
    fireEvent.change(within(section).getByLabelText("Limit (tokens)"), {
      target: { value: "9007199254740993.125" },
    });
    fireEvent.click(within(section).getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.scope).toEqual({ kind: "connection", namespace: "local", connection: "c2" });
    expect(saved[0]!.limit).toEqual({ value: 9007199254740993125n, scale: 3, unit: "tokens" });
    expect(saved[0]!.window).toEqual({ kind: "calendar_month", timezone: "UTC" });
    expect(saved[0]!.version).toBe(1);
  });
  test("monthly creation has one host identity across page remounts", async () => {
    const { BudgetsPage } = await load("pages/budgets.tsx");
    const definitions = [structuredClone(budget)];
    const meter = await memory(definitions);
    const save = vi.fn(async (value: Budget) => {
      definitions.push(structuredClone(value));
      return { outcome: "saved" as const, budget: value };
    });
    const node = createElement(
      MeterProvider,
      { meter, access, budgetWriter: { save } },
      createElement(BudgetsPage!, { connections: [], units: ["requests", "cents"] }),
    );
    const first = render(node);
    fireEvent.click(await screen.findByRole("button", { name: "Create Monthly cents" }));
    fireEvent.change(screen.getByLabelText("Limit (cents)"), { target: { value: "10.1250" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    first.unmount();
    render(node);
    await screen.findByRole("button", { name: "Edit Monthly cents" });
    expect(definitions[1]!.id).toBe("ui-monthly:principal:local:cents");
    expect(screen.queryByRole("button", { name: "Create Monthly cents" })).toBeNull();
    expect(save).toHaveBeenCalledOnce();
  });
  test("existing budget edit preserves its original scope, unit and window", async () => {
    const { BudgetsPage } = await load("pages/budgets.tsx");
    const definitions = [structuredClone(budget)];
    const meter = await memory(definitions);
    const save = vi.fn(async (value: Budget) => {
      definitions.push(structuredClone(value));
      return { outcome: "saved" as const, budget: value };
    });
    render(
      createElement(
        MeterProvider,
        { meter, access, budgetWriter: { save } },
        createElement(BudgetsPage!, { connections: [], units: ["requests"] }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Edit / }));
    fireEvent.change(screen.getByLabelText("Limit (requests)"), { target: { value: "12.500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0]).toMatchObject({
      id: "monthly",
      version: 2,
      scope: budget.scope,
      unit: budget.unit,
      window: budget.window,
    });
  });
});

test("failed binding verification never enables provider management", async () => {
  const { App } = await load("App.tsx");
  const paths: string[] = [];
  const fetch = async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    return path === "/providers/management/binding"
      ? Response.json({ message: "denied" }, { status: 403 })
      : Response.json([]);
  };
  render(createElement(App!, { baseUrl: "http://local.test", fetch }));
  fireEvent.change(screen.getByLabelText("Server token"), {
    target: { value: "invalid-local-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByText("Could not open the authenticated local dashboard.");
  expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
  expect(paths).not.toContain("/providers/management/read");
  expect(paths).not.toContain("/providers/management/commands");
});
