import { createElement } from "react";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
  ProviderActionResult,
  ProviderBinding,
  ProviderCommand,
  ProviderConnection,
  ProviderManagementPort,
  ProviderReadResult,
  ProviderQuery,
  ProviderReconciliation,
  ProviderSnapshot,
} from "@usagekit/views";
import {
  ProviderManagementProvider,
  createProviderQueryClient,
  useProviderAction,
  useProviderConnections,
  useProviderConnection,
  useProviderBalance,
  useProviderAllocations,
  useProviderProjection,
  useBudgetProjection,
} from "./index.js";

afterEach(cleanup);
let fixtureId = 0;
const connection: ProviderConnection = {
  id: "connection",
  provider: "search",
  label: "Search",
  revision: "1",
  fundingSource: "byok",
  enabled: true,
  priority: 1,
  fallbackChain: [],
  plan: null,
  status: { state: "connected" },
  availability: { state: "unknown" },
  freshness: { observedAt: null, source: "unknown", stale: true },
  capabilities: ["test", "reconnect", "disconnect", "funding", "settings", "rates"],
  rates: [],
  hasStoredCredentials: true,
};
const command: ProviderCommand = {
  kind: "settings",
  commandId: "command",
  connectionId: "connection",
  expectedRevision: "1",
  changes: { priority: 2 },
};
const success = (id: string): ProviderActionResult => ({
  outcome: "success",
  commandId: id,
  revision: "2",
});
const list = (label = "Search"): ProviderReadResult => ({
  outcome: "ok",
  value: {
    kind: "connections",
    state: "ok",
    problem: null,
    asOf: null,
    revision: "1",
    connections: [{ ...connection, label }],
    providers: [],
  },
});
function fixture(overrides: Partial<ProviderManagementPort> = {}) {
  const binding: ProviderBinding = {
    scopeKey: `fixture-host:project:${++fixtureId}`,
    principalKey: "owner",
    authRevision: "1",
    canManage: true,
  };
  const port: ProviderManagementPort = {
    read: vi.fn(async () => list()),
    execute: vi.fn(async (_binding, input) => success(input.commandId)),
    ...overrides,
  };
  const client = createProviderQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ProviderManagementProvider, { port, binding, client }, children);
  return { binding, port, client, wrapper };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("read-only access can reconcile an original unknown command without granting a new write", async () => {
  const f = fixture({
    execute: vi.fn().mockRejectedValue(new Error("response lost")),
    reconcile: vi.fn(async (_binding, input) => success(input.commandId)),
  });
  const { result, rerender } = renderHook(
    (binding: ProviderBinding) => useProviderAction({ ...f, binding }),
    { initialProps: f.binding },
  );
  await act(async () => {
    await result.current.run(command);
  });
  rerender({ ...f.binding, authRevision: "view-only", canManage: false });
  expect(result.current.canWrite).toBe(false);
  expect(result.current.canReconcile).toBe(true);
  expect(result.current.ambiguous).toBe(true);
  await act(async () => {
    expect((await result.current.reconcile()).outcome).toBe("success");
  });
  expect(result.current.ambiguous).toBe(false);
  expect((await result.current.run({ ...command, commandId: "new-command" })).outcome).toBe(
    "forbidden",
  );
  expect(f.port.execute).toHaveBeenCalledTimes(1);
  expect(f.port.reconcile).toHaveBeenCalledWith(
    expect.objectContaining({ canManage: false }),
    command,
  );
});

test("a denied status read keeps the original ambiguous command fenced", async () => {
  const f = fixture({
    execute: vi.fn().mockRejectedValue(new Error("response lost")),
    reconcile: vi.fn(async (_binding, input) => ({
      outcome: "forbidden" as const,
      commandId: input.commandId,
    })),
  });
  const { result, rerender } = renderHook(
    (binding: ProviderBinding) => useProviderAction({ ...f, binding }),
    { initialProps: f.binding },
  );
  await act(async () => {
    await result.current.run(command);
  });
  rerender({ ...f.binding, authRevision: "view-only", canManage: false });
  await act(async () => {
    expect((await result.current.reconcile()).outcome).toBe("forbidden");
  });
  expect(result.current.ambiguous).toBe(true);
  act(() => {
    result.current.reset();
  });
  rerender({ ...f.binding, authRevision: "management-restored" });
  expect((await result.current.run({ ...command, commandId: "new-command" })).outcome).toBe(
    "unavailable",
  );
  expect(f.port.execute).toHaveBeenCalledTimes(1);
});

test("replacing the read client cannot release an ambiguous provider command", async () => {
  const execute = vi.fn().mockRejectedValue(new Error("response lost"));
  const f = fixture({ execute });
  const first = renderHook(() => useProviderAction(f));
  await act(async () => {
    await first.result.current.run(command);
  });
  first.unmount();
  const replacementClient = createProviderQueryClient();
  const second = renderHook(() => useProviderAction({ ...f, client: replacementClient }));
  expect(second.result.current.ambiguous).toBe(true);
  await act(async () => {
    await second.result.current.run({ ...command, commandId: "other" });
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

test("a new host adapter for the same journal cannot release an unknown command", async () => {
  const f = fixture({ execute: vi.fn().mockRejectedValue(new Error("response lost")) });
  const first = renderHook(() => useProviderAction(f));
  await act(async () => {
    await first.result.current.run(command);
  });
  first.unmount();
  const execute = vi.fn(async (_binding, input: ProviderCommand) => success(input.commandId));
  const replacementPort = { ...f.port, execute };
  const replacementClient = createProviderQueryClient();
  const second = renderHook(() =>
    useProviderAction({ ...f, port: replacementPort, client: replacementClient }),
  );
  expect(second.result.current.ambiguous).toBe(true);
  await act(async () => {
    await second.result.current.run({ ...command, commandId: "other" });
  });
  expect(execute).not.toHaveBeenCalled();
});

test("equal provider reads deduplicate and mounting never tests credentials", async () => {
  const f = fixture();
  const { result } = renderHook(() => [useProviderConnections(), useProviderConnections({})], {
    wrapper: f.wrapper,
  });
  await waitFor(() => expect(result.current.every((view) => view.state === "ok")).toBe(true));
  expect(f.port.read).toHaveBeenCalledTimes(1);
  expect(f.port.execute).not.toHaveBeenCalled();
});

test("binding changes hide prior evidence immediately and late old success cannot replace forbidden", async () => {
  const old = deferred<ProviderReadResult>();
  const current = deferred<ProviderReadResult>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const f = fixture({ read });
  const { result, rerender } = renderHook(
    (binding: ProviderBinding) => useProviderConnections({ ...f, binding }),
    { initialProps: f.binding },
  );
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  rerender({ ...f.binding, authRevision: "revoked", canManage: false });
  expect(result.current.data).toBeNull();
  await act(async () => {
    current.resolve({ outcome: "forbidden" });
  });
  await waitFor(() => expect(result.current.state).toBe("forbidden"));
  await act(async () => {
    old.resolve(list("original private label"));
  });
  expect(result.current).toMatchObject({ state: "forbidden", data: null });
});

test("a different host port or query target never displays the previous snapshot", async () => {
  const f = fixture();
  const pending = deferred<ProviderReadResult>();
  const other: ProviderManagementPort = {
    ...f.port,
    read: vi.fn().mockReturnValue(pending.promise),
  };
  const { result, rerender } = renderHook(
    (port: ProviderManagementPort) => useProviderConnections({ ...f, port }),
    { initialProps: f.port },
  );
  await waitFor(() => expect(result.current.state).toBe("ok"));
  rerender(other);
  expect(result.current.data).toBeNull();
  await act(async () => {
    pending.resolve(list("new host"));
  });
  await waitFor(() => expect(result.current.data?.connections[0]?.label).toBe("new host"));
});

test.each(["forbidden", "unavailable"] as const)(
  "an ok envelope marked %s cannot expose its included rows",
  async (state) => {
    const reply = list();
    if (reply.outcome !== "ok") throw new Error("fixture");
    const f = fixture({
      read: vi.fn(async () => ({ ...reply, value: { ...reply.value, state } })),
    });
    const { result } = renderHook(() => useProviderConnections(f));
    await waitFor(() => expect(result.current.state).toBe(state));
    expect(result.current.data).toBeNull();
  },
);

test("provider filters and detail targets reject mismatching host snapshots", async () => {
  const f = fixture();
  const filtered = renderHook(() =>
    useProviderConnections({ ...f, provider: "different-provider" }),
  );
  await waitFor(() => expect(filtered.result.current.state).toBe("unavailable"));
  expect(filtered.result.current.data).toBeNull();
  const read: ProviderManagementPort["read"] = vi.fn(
    async (): Promise<ProviderReadResult> => ({
      outcome: "ok",
      value: { kind: "details", state: "ok", problem: null, asOf: null, revision: "1", connection },
    }),
  );
  const detailPort = { ...f.port, read };
  const detail = renderHook(() =>
    useProviderConnection({
      ...f,
      port: detailPort,
      connectionId: "different-connection",
    }),
  );
  await waitFor(() => expect(detail.result.current.state).toBe("unavailable"));
  expect(detail.result.current.data).toBeNull();
});

test("cache snapshots and original read inputs do not follow later object mutations", async () => {
  const reply = list();
  const read = vi.fn(async () => reply);
  const f = fixture({ read });
  const binding = { ...f.binding };
  const query = { kind: "connections" as const, provider: "search" };
  const entry = f.client.entry(f.port, binding, query);
  binding.principalKey = "different-owner";
  query.provider = "different-provider";
  f.client.ensure(entry);
  await waitFor(() => expect(entry.snapshot.state).toBe("ok"));
  expect(read.mock.calls[0]).toEqual([
    { ...f.binding },
    { kind: "connections", provider: "search" },
  ]);
  if (reply.outcome !== "ok" || reply.value.kind !== "connections") throw new Error("fixture");
  reply.value.connections[0]!.label = "mutated host label";
  expect(
    entry.snapshot.data?.kind === "connections" && entry.snapshot.data.connections[0]?.label,
  ).toBe("Search");
});

test("refresh reaches all subscribers and fences a superseded pending read", async () => {
  const old = deferred<ProviderReadResult>(),
    fresh = deferred<ProviderReadResult>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const f = fixture({ read });
  const { result } = renderHook(() => [useProviderConnections(), useProviderConnections()], {
    wrapper: f.wrapper,
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  act(() => result.current[0]!.refresh());
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => {
    fresh.resolve(list("new snapshot"));
  });
  await waitFor(() => expect(result.current[1]?.data?.connections[0]?.label).toBe("new snapshot"));
  await act(async () => {
    old.resolve(list("old snapshot"));
  });
  expect(result.current[0]?.data?.connections[0]?.label).toBe("new snapshot");
});

test("missing management permission defaults to readonly and never calls the host writer", async () => {
  const f = fixture();
  const readonlyBinding = { ...f.binding };
  delete readonlyBinding.canManage;
  const { result } = renderHook(() => useProviderAction({ ...f, binding: readonlyBinding }));
  expect(result.current.canWrite).toBe(false);
  expect(await result.current.run(command)).toEqual({
    outcome: "forbidden",
    commandId: command.commandId,
  });
  expect(f.port.execute).not.toHaveBeenCalled();
});

test("draft credential test is manual, never connects, and secrets only reach the ephemeral third argument", async () => {
  let observed: Record<string, string> | undefined;
  const execute: ProviderManagementPort["execute"] = vi.fn(async (_binding, input, secrets) => {
    observed = secrets ? { ...secrets } : undefined;
    return success(input.commandId);
  });
  const f = fixture({ execute });
  const { result } = renderHook(() => useProviderAction(f));
  expect(execute).not.toHaveBeenCalled();
  const input: ProviderCommand = {
    kind: "test",
    commandId: "draft-test",
    provider: "search",
    fundingSource: "byok",
  };
  const own = { key: "synthetic-local-credential" };
  await act(async () => {
    await result.current.run(input, own);
  });
  expect(observed).toEqual(own);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(vi.mocked(execute).mock.calls[0]?.[1]).toEqual(input);
  expect(vi.mocked(execute).mock.calls[0]?.[2]).toEqual({});
  expect(JSON.stringify(result.current)).not.toContain(own.key);
  expect(result.current.submittedCommand).toEqual(input);
  expect(own.key).toBe("synthetic-local-credential");
});

test("unknown commands block changed actions and reset until a secret-free authoritative reconciliation", async () => {
  const execute = vi
    .fn()
    .mockRejectedValue(new Error("synthetic-local-credential must never be cached"));
  const reconcile = vi.fn(async (_binding, input: ProviderCommand) => success(input.commandId));
  const f = fixture({ execute, reconcile });
  const first = renderHook(() => useProviderAction(f));
  await act(async () => {
    await first.result.current.run(command, { key: "synthetic-local-credential" });
  });
  expect(first.result.current).toMatchObject({ state: "unavailable", ambiguous: true });
  expect(JSON.stringify(first.result.current)).not.toContain("synthetic-local-credential");
  act(() => first.result.current.reset());
  const second = renderHook(() => useProviderAction(f));
  await act(async () => {
    await second.result.current.run({
      kind: "disconnect",
      commandId: "second",
      connectionId: "connection",
      expectedRevision: "1",
    });
  });
  expect(execute).toHaveBeenCalledTimes(1);
  await act(async () => {
    expect((await second.result.current.reconcile()).outcome).toBe("success");
  });
  expect(reconcile.mock.calls[0]).toEqual([f.binding, command]);
  expect(first.result.current.ambiguous).toBe(false);
});

test("auth revision changes hide an unknown body without releasing its gate", async () => {
  const execute = vi.fn().mockRejectedValue(new Error("response lost"));
  const reconcile = vi.fn(async (_binding, input: ProviderCommand) => success(input.commandId));
  const f = fixture({ execute, reconcile });
  const { result, rerender } = renderHook(
    (binding: ProviderBinding) => useProviderAction({ ...f, binding }),
    { initialProps: f.binding },
  );
  await act(async () => {
    await result.current.run(command);
  });
  rerender({ ...f.binding, authRevision: "2" });
  expect(result.current).toMatchObject({ result: null, submittedCommand: null, ambiguous: true });
  await act(async () => {
    await result.current.run({ ...command, commandId: "other" });
    await result.current.reconcile();
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(reconcile.mock.calls[0]?.[0].authRevision).toBe("2");
  expect(result.current.ambiguous).toBe(false);
});

test("pending commands keep the exact immutable batch matrix and never submit a second action", async () => {
  const pending = deferred<ProviderActionResult>();
  const execute = vi.fn().mockReturnValue(pending.promise);
  const f = fixture({ execute });
  const { result } = renderHook(() => useProviderAction(f));
  const input: ProviderCommand = {
    kind: "allocations",
    commandId: "matrix",
    expectedRevision: "1",
    changes: [
      { rowId: "own-app", expectedRevision: "2", limit: "9007199254740993.000001" },
      { rowId: "credits-programmatic", expectedRevision: "3", limit: null },
      { rowId: "own-programmatic", expectedRevision: "4" },
    ],
  };
  let reply!: Promise<ProviderActionResult>;
  act(() => {
    reply = result.current.run(input);
  });
  input.changes[0]!.limit = "1";
  expect(
    result.current.submittedCommand?.kind === "allocations" &&
      result.current.submittedCommand.changes[0]?.limit,
  ).toBe("9007199254740993.000001");
  expect(Object.isFrozen(result.current.submittedCommand)).toBe(true);
  await act(async () => {
    await result.current.run(command);
    expect((await result.current.reconcile()).outcome).toBe("unavailable");
  });
  expect(execute).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve(success("matrix"));
    await reply;
  });
});

test("retained callbacks stay fenced after auth changes return and after unmount", async () => {
  const f = fixture();
  const { result, rerender, unmount } = renderHook(
    (binding: ProviderBinding) => useProviderAction({ ...f, binding }),
    { initialProps: f.binding },
  );
  const before = result.current.run;
  rerender({ ...f.binding, canManage: false });
  rerender(f.binding);
  expect((await before(command)).outcome).toBe("forbidden");
  const mounted = result.current.run;
  unmount();
  expect((await mounted(command)).outcome).toBe("forbidden");
  expect(f.port.execute).not.toHaveBeenCalled();
});

test("a late unmounted success is fenced and leaves the original command available for reconciliation", async () => {
  const pending = deferred<ProviderActionResult>();
  const f = fixture({
    execute: vi.fn().mockReturnValue(pending.promise),
    reconcile: vi.fn(async (_binding, input) => success(input.commandId)),
  });
  const first = renderHook(() => useProviderAction(f));
  let reply!: Promise<ProviderActionResult>;
  act(() => {
    reply = first.result.current.run(command);
  });
  first.unmount();
  pending.resolve(success(command.commandId));
  expect((await reply).outcome).toBe("forbidden");
  const second = renderHook(() => useProviderAction(f));
  expect(second.result.current.ambiguous).toBe(true);
  await act(async () => {
    await second.result.current.reconcile();
  });
  expect(second.result.current.ambiguous).toBe(false);
  expect(f.port.execute).toHaveBeenCalledTimes(1);
});

test("no reconciliation port and mismatching command IDs never prove a write absent", async () => {
  const f = fixture({ execute: vi.fn(async () => success("wrong-id")) });
  const { result } = renderHook(() => useProviderAction(f));
  await act(async () => {
    await result.current.run(command);
    await result.current.reconcile();
  });
  expect(result.current.ambiguous).toBe(true);
  expect(f.port.read).not.toHaveBeenCalled();
  expect(f.port.execute).toHaveBeenCalledTimes(1);
});

test("definitive not_applied releases the original gate without automatically retrying", async () => {
  const f = fixture({
    execute: vi.fn().mockRejectedValue(new Error("unknown")),
    reconcile: vi.fn(
      async (
        _binding: ProviderBinding,
        input: ProviderCommand,
      ): Promise<ProviderReconciliation> => ({
        outcome: "not_applied",
        commandId: input.commandId,
      }),
    ),
  });
  const { result } = renderHook(() => useProviderAction(f));
  await act(async () => {
    await result.current.run(command);
    await result.current.reconcile();
  });
  expect(result.current).toMatchObject({ state: "idle", ambiguous: false, submittedCommand: null });
  expect(f.port.execute).toHaveBeenCalledTimes(1);
});

test("CAS conflicts refresh provider evidence without silently changing or resubmitting a command", async () => {
  const execute = vi.fn(
    async (_binding, input: ProviderCommand): Promise<ProviderActionResult> => ({
      outcome: "conflict",
      commandId: input.commandId,
      reason: "revision",
      currentRevision: "2",
    }),
  );
  const f = fixture({ execute });
  const { result } = renderHook(
    () => ({ data: useProviderConnections(), action: useProviderAction() }),
    { wrapper: f.wrapper },
  );
  await waitFor(() => expect(result.current.data.state).toBe("ok"));
  await act(async () => {
    await result.current.action.run(command);
  });
  await waitFor(() => expect(f.port.read).toHaveBeenCalledTimes(2));
  expect(result.current.action).toMatchObject({
    state: "conflict",
    ambiguous: false,
    submittedCommand: command,
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

test("raw credentials in command fields and reused command IDs with changed bodies are rejected", async () => {
  const f = fixture();
  const { result } = renderHook(() => useProviderAction(f));
  await act(async () => {
    expect(
      (await result.current.run({ ...command, apiKey: "synthetic" } as ProviderCommand)).outcome,
    ).toBe("invalid");
    await result.current.run(command);
    expect((await result.current.run({ ...command, changes: { priority: 9 } })).outcome).toBe(
      "invalid",
    );
  });
  expect(f.port.execute).toHaveBeenCalledTimes(1);
});

test("balance, allocation and request quote hooks keep independent units and unknown evidence", async () => {
  const read: ProviderManagementPort["read"] = vi.fn(
    async (_binding: ProviderBinding, query: ProviderQuery): Promise<ProviderReadResult> => {
      const base = { state: "ok" as const, problem: null, revision: "1", asOf: null };
      const freshness = { source: "unknown" as const, observedAt: null, stale: true };
      let value: ProviderSnapshot;
      if (query.kind === "balance")
        value = {
          ...base,
          kind: "balance",
          balance: {
            connectionId: query.connectionId,
            fundingSource: "byok",
            authority: "provider",
            balance: { text: "", unit: "cents", certainty: "unknown" },
            reserved: "unavailable",
            availability: { state: "unknown" },
            freshness,
          },
        };
      else if (query.kind === "projection")
        value = {
          ...base,
          kind: "projection",
          projection: {
            connectionId: query.connectionId,
            quantity: { text: query.quantity, unit: query.unit, certainty: "estimated" },
            providerCost: { text: "0.6250", unit: "cents", certainty: "estimated" },
            customerCharge: { text: "0.9000", unit: "customer_cents", certainty: "estimated" },
            canProceed: "unknown",
            freshness,
          },
        };
      else value = { ...base, kind: "allocations", rows: [] };
      return { outcome: "ok", value };
    },
  );
  const f = fixture({ read });
  const { result } = renderHook(
    () => ({
      balance: useProviderBalance({ connectionId: connection.id }),
      allocations: useProviderAllocations({ connectionIds: [connection.id] }),
      quote: useProviderProjection({
        connectionId: connection.id,
        operation: "search",
        quantity: "9007199254740993",
        unit: "requests",
        surface: "app",
      }),
    }),
    { wrapper: f.wrapper },
  );
  await waitFor(() => expect(result.current.quote.state).toBe("ok"));
  expect(result.current.balance.data?.balance?.balance).toMatchObject({ certainty: "unknown" });
  expect(result.current.quote.data?.projection).toMatchObject({
    quantity: { text: "9007199254740993" },
    providerCost: { unit: "cents" },
    customerCharge: { unit: "customer_cents" },
  });
  expect(f.port.execute).not.toHaveBeenCalled();
});

test("budget forecasts are pure and unknown inputs never become zero spend", () => {
  const measured = (text: string) => ({ text, unit: "cents", certainty: "measured" as const });
  const { result, rerender } = renderHook(
    (limit: string | null) =>
      useBudgetProjection(
        limit === null
          ? null
          : {
              used: measured("4"),
              reserved: measured("1"),
              limit: measured(limit),
              periodStart: "2026-10-01T00:00:00Z",
              asOf: "2026-10-02T00:00:00Z",
              periodEnd: "2026-11-01T00:00:00Z",
            },
      ),
    { initialProps: null as string | null },
  );
  expect(result.current.kind).toBe("unavailable");
  rerender("9");
  expect(result.current).toEqual({
    kind: "estimated",
    at: "2026-10-03T00:00:00.000Z",
    basis: "observed_average",
  });
});

test("a successful credential command cannot claim to test new credentials with its old nonce", async () => {
  const f = fixture();
  const { result } = renderHook(() => useProviderAction(f));
  const input: ProviderCommand = {
    kind: "test",
    commandId: "draft",
    provider: "search",
    fundingSource: "byok",
  };
  await act(async () => {
    await result.current.run(input, { key: "first-synthetic" });
    expect((await result.current.run(input, { key: "different-synthetic" })).outcome).toBe(
      "invalid",
    );
  });
  expect(f.port.execute).toHaveBeenCalledTimes(1);
});

test("typed host replies cannot retain echoed credential material", async () => {
  const f = fixture({
    execute: vi.fn(
      async (_binding: ProviderBinding, input: ProviderCommand): Promise<ProviderActionResult> => ({
        outcome: "unavailable",
        commandId: input.commandId,
        message: "provider rejected synthetic-private-key",
        ambiguous: false,
      }),
    ),
  });
  const { result } = renderHook(() => useProviderAction(f));
  await act(async () => {
    await result.current.run(command, { key: "synthetic-private-key" });
  });
  expect(JSON.stringify(result.current)).not.toContain("synthetic-private-key");
  expect(result.current.ambiguous).toBe(false);
});

test("credential text equal to a protocol constant still permits an explicit test", async () => {
  const f = fixture();
  const { result } = renderHook(() => useProviderAction(f));
  const input: ProviderCommand = {
    kind: "test",
    commandId: "draft",
    provider: "search",
    fundingSource: "byok",
  };
  await act(async () => {
    expect((await result.current.run(input, { password: "test" })).outcome).toBe("success");
  });
  expect(f.port.execute).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.port.execute).mock.calls[0]?.[2]).toEqual({});
});
