import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ProviderActionResult,
  ProviderBinding,
  ProviderCommand,
  ProviderReadResult,
} from "@usagekit/views";
import { startServer } from "./index.js";

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-management-"));
  directories.push(dir);
  let token = "";
  const transport = vi.fn<typeof fetch>();
  const options = {
    configDir: dir,
    port: 0,
    passphrase: "synthetic-local-passphrase",
    providerFetch: transport,
  };
  const server = await startServer({
    ...options,
    onToken: (value) => {
      token = value;
    },
  });
  const send = async (path: string, body?: unknown, auth = token) =>
    fetch(server.url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const command = async (command: ProviderCommand, secrets?: Record<string, string>) =>
    (await (
      await send("/providers/management/commands", { command, ...(secrets ? { secrets } : {}) })
    ).json()) as ProviderActionResult;
  const connect = () =>
    command(
      {
        kind: "connect",
        commandId: crypto.randomUUID(),
        provider: "serpapi",
        fundingSource: "byok",
      },
      { secret: "synthetic-own-key" },
    );
  return { server, send, command, connect, transport, dir, options, token };
}

test("verified management binding and strict reads never probe providers or expose credentials", async () => {
  const f = await fixture();
  try {
    expect((await f.send("/providers/management/binding", undefined, "wrong")).status).toBe(401);
    const binding = (await (
      await f.send("/providers/management/binding")
    ).json()) as ProviderBinding;
    expect(binding).toMatchObject({ principalKey: "local", canManage: true });
    expect(binding.scopeKey).toMatch(/^usagekit-local:/);
    const connected = await f.connect();
    expect(connected.outcome).toBe("success");
    const read = (await (
      await f.send("/providers/management/read", { query: { kind: "connections" } })
    ).json()) as ProviderReadResult;
    expect(read).toMatchObject({
      outcome: "ok",
      value: {
        kind: "connections",
        connections: [{ fundingSource: "byok", status: { state: "unknown" } }],
      },
    });
    expect(JSON.stringify(read)).not.toContain("synthetic-own-key");
    expect(
      (
        await f.send("/providers/management/read", {
          query: { kind: "connections" },
          binding: { canManage: true },
        })
      ).status,
    ).toBe(400);
    expect(f.transport).not.toHaveBeenCalled();
  } finally {
    await f.server.stop();
  }
});

test("durable command replay and original-body reconciliation survive restart without applying new secrets", async () => {
  const f = await fixture();
  const command: ProviderCommand = {
    kind: "connect",
    commandId: crypto.randomUUID(),
    provider: "serpapi",
    fundingSource: "byok",
  };
  const saved = await f.command(command, { secret: "synthetic-original-key" });
  await f.server.stop();
  const restarted = await startServer(f.options);
  try {
    const send = async (path: string, body: unknown) =>
      (
        await fetch(restarted.url + path, {
          method: "POST",
          headers: { Authorization: `Bearer ${f.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
    expect(
      await send("/providers/management/commands", {
        command,
        secrets: { secret: "synthetic-changed-key" },
      }),
    ).toEqual(saved);
    expect(await send("/providers/management/reconcile", { command })).toEqual(saved);
    expect(restarted.vault.list()).toHaveLength(1);
    if (saved.outcome !== "success" || !saved.connection)
      throw new Error("Expected saved connection");
    expect(restarted.vault.get("serpapi", saved.connection.id)).toBe("synthetic-original-key");
    for (const file of readdirSync(f.dir, { recursive: true }) as string[]) {
      if (statSync(join(f.dir, file)).isDirectory()) continue;
      const bytes = readFileSync(join(f.dir, file));
      expect(bytes.includes(Buffer.from("synthetic-original-key"))).toBe(false);
      expect(bytes.includes(Buffer.from("synthetic-changed-key"))).toBe(false);
    }
  } finally {
    await restarted.stop();
  }
});

test("old connection endpoints change the random persisted revision and stale commands cannot mutate", async () => {
  const f = await fixture();
  try {
    const saved = await f.connect();
    if (saved.outcome !== "success" || !saved.connection) throw new Error("Expected connection");
    const connectionId = saved.connection.id;
    await f.send("/providers/connections", {
      provider: "serpapi",
      connectionId,
      secret: "synthetic-legacy-rotation",
    });
    const stale: ProviderCommand = {
      kind: "reconnect",
      commandId: crypto.randomUUID(),
      connectionId,
      expectedRevision: saved.connection.revision,
    };
    expect(await f.command(stale, { secret: "synthetic-refused-key" })).toMatchObject({
      outcome: "conflict",
    });
    expect(f.server.vault.get("serpapi", connectionId)).toBe("synthetic-legacy-rotation");
    const revision = f.server.vault
      .describe()
      .find((entry) => entry.connectionId === connectionId)!.revision!;
    expect(revision).not.toBe(saved.connection.revision);
    const reconnect: ProviderCommand = {
      ...stale,
      commandId: crypto.randomUUID(),
      expectedRevision: revision,
    };
    const replaced = await f.command(reconnect, { secret: "synthetic-new-key" });
    expect(replaced.outcome).toBe("success");
    expect(await f.command(reconnect, { secret: "synthetic-replay-key" })).toEqual(replaced);
    expect(f.server.vault.get("serpapi", connectionId)).toBe("synthetic-new-key");
    expect(
      await f.command(
        { ...reconnect, expectedRevision: "different-body" },
        { secret: "synthetic-replay-key" },
      ),
    ).toMatchObject({ outcome: "invalid", field: "commandId" });
    const deletion = await fetch(f.server.url + "/providers/connections/" + connectionId, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${f.token}` },
    });
    expect(deletion.status).toBe(200);
    expect(
      await f.command(
        { ...reconnect, commandId: crypto.randomUUID() },
        { secret: "synthetic-after-delete" },
      ),
    ).toMatchObject({ outcome: "conflict" });
  } finally {
    await f.server.stop();
  }
});

test("a vault commit followed by journal failure remains ambiguous across restart and blocks repeat mutations", async () => {
  const f = await fixture();
  const command: ProviderCommand = {
    kind: "connect",
    commandId: crypto.randomUUID(),
    provider: "serpapi",
    fundingSource: "byok",
  };
  f.server.store.database.exec(
    "CREATE TRIGGER fixture_interrupt_result BEFORE UPDATE ON local_provider_commands BEGIN SELECT RAISE(ABORT, 'fixture interruption'); END",
  );
  expect(await f.command(command, { secret: "synthetic-interrupted-key" })).toMatchObject({
    outcome: "unavailable",
    ambiguous: true,
  });
  expect(f.server.vault.list()).toHaveLength(1);
  const row = f.server.store.database
    .prepare(
      "SELECT command_hash, target, result FROM local_provider_commands WHERE command_id = ?",
    )
    .get(command.commandId) as { command_hash: string; target: string; result: null };
  expect(row.result).toBeNull();
  expect(row.command_hash).toMatch(/^[a-f0-9]{64}$/);
  await f.server.stop();
  const restarted = await startServer(f.options);
  try {
    const send = async (path: string, body: unknown) =>
      (
        await fetch(restarted.url + path, {
          method: "POST",
          headers: { Authorization: `Bearer ${f.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
    expect(await send("/providers/management/reconcile", { command })).toMatchObject({
      outcome: "unavailable",
      ambiguous: true,
    });
    expect(
      await send("/providers/management/commands", {
        command,
        secrets: { secret: "synthetic-redelivery-key" },
      }),
    ).toMatchObject({ outcome: "unavailable", ambiguous: true });
    expect(
      await send("/providers/management/commands", {
        command: { ...command, commandId: crypto.randomUUID() },
        secrets: { secret: "synthetic-new-attempt" },
      }),
    ).toMatchObject({ outcome: "unavailable", ambiguous: false });
    expect(
      await send("/providers/connections", {
        provider: "serpapi",
        connectionId: row.target,
        secret: "synthetic-legacy-bypass",
      }),
    ).toEqual({ error: "provider_command_unresolved" });
    expect(restarted.vault.get("serpapi", row.target)).toBe("synthetic-interrupted-key");
    expect(restarted.vault.list()).toHaveLength(1);
    expect(f.transport).not.toHaveBeenCalled();
  } finally {
    await restarted.stop();
  }
});

test("absence of a command journal is never proof of not-applied; reconcile accepts no secret or caller binding", async () => {
  const f = await fixture();
  try {
    const command: ProviderCommand = {
      kind: "connect",
      commandId: crypto.randomUUID(),
      provider: "serpapi",
      fundingSource: "byok",
    };
    expect(
      await (await f.send("/providers/management/reconcile", { command })).json(),
    ).toMatchObject({ outcome: "unavailable", ambiguous: true });
    for (const extra of [
      { secrets: { secret: "synthetic-forbidden-reconcile-key" } },
      { binding: { scopeKey: "other-host", canManage: true } },
    ])
      expect((await f.send("/providers/management/reconcile", { command, ...extra })).status).toBe(
        400,
      );
    expect(f.server.vault.list()).toEqual([]);
  } finally {
    await f.server.stop();
  }
});

test("manual rates are exact, atomically validate every row, and clear only selected overrides", async () => {
  const f = await fixture();
  try {
    const connected = await f.connect();
    if (connected.outcome !== "success" || !connected.connection)
      throw new Error("Expected connection");
    const connectionId = connected.connection.id;
    const rates: ProviderCommand = {
      kind: "rates",
      commandId: crypto.randomUUID(),
      connectionId,
      expectedRevision: connected.connection.revision,
      rates: [{ rateId: "search", price: "9007199254740993.000000000000000001" }],
    };
    const saved = await f.command(rates);
    expect(saved).toMatchObject({
      outcome: "success",
      connection: {
        rates: [
          {
            price: { text: "9007199254740993.000000000000000001", unit: "units" },
            provenance: { source: "manual" },
          },
        ],
      },
    });
    if (saved.outcome !== "success" || !saved.connection) throw new Error("Expected saved rates");
    const before = f.server.vault.describe();
    expect(
      await f.command({
        ...rates,
        commandId: crypto.randomUUID(),
        expectedRevision: saved.connection.revision,
        rates: [
          { rateId: "search", price: "2" },
          { rateId: "not-catalog-operation", price: "3" },
        ],
      }),
    ).toMatchObject({ outcome: "invalid", field: "rates" });
    expect(f.server.vault.describe()).toEqual(before);
    expect(
      await f.command({
        ...rates,
        commandId: crypto.randomUUID(),
        expectedRevision: saved.connection.revision,
        rates: [{ rateId: "search", price: null }],
      }),
    ).toMatchObject({ outcome: "success", connection: { rates: [{ price: "unavailable" }] } });
    expect(f.transport).not.toHaveBeenCalled();
  } finally {
    await f.server.stop();
  }
});

test("local capabilities refuse platform funding, settings, allocations and disabled providers honestly", async () => {
  const f = await fixture();
  try {
    const connected = await f.connect();
    if (connected.outcome !== "success" || !connected.connection)
      throw new Error("Expected connection");
    expect(connected.connection.capabilities).toEqual(["test", "reconnect", "disconnect", "rates"]);
    const existing = {
      connectionId: connected.connection.id,
      expectedRevision: connected.connection.revision,
    };
    for (const command of [
      {
        kind: "connect",
        commandId: crypto.randomUUID(),
        provider: "serpapi",
        fundingSource: "platform",
      },
      { kind: "funding", commandId: crypto.randomUUID(), ...existing, fundingSource: "platform" },
      {
        kind: "settings",
        commandId: crypto.randomUUID(),
        ...existing,
        changes: { enabled: false },
      },
      {
        kind: "allocations",
        commandId: crypto.randomUUID(),
        expectedRevision: "allocation-version",
        changes: [{ rowId: "row", expectedRevision: "v1", limit: "5" }],
      },
      {
        kind: "connect",
        commandId: crypto.randomUUID(),
        provider: "disabled",
        fundingSource: "byok",
      },
    ] satisfies ProviderCommand[])
      expect(await f.command(command)).toMatchObject({ outcome: "invalid" });
    for (const query of [
      { kind: "balance", connectionId: existing.connectionId },
      {
        kind: "projection",
        connectionId: existing.connectionId,
        operation: "search",
        quantity: "1",
        unit: "requests",
        surface: "app",
      },
      { kind: "allocations", connectionIds: [existing.connectionId] },
    ])
      expect(await (await f.send("/providers/management/read", { query })).json()).toMatchObject({
        outcome: "unavailable",
      });
    expect(f.server.vault.list()).toHaveLength(1);
    expect(f.transport).not.toHaveBeenCalled();
  } finally {
    await f.server.stop();
  }
});

test("explicit draft and stored format tests never authenticate upstream and every malformed wire is rejected", async () => {
  const f = await fixture();
  try {
    const command: ProviderCommand = {
      kind: "test",
      commandId: crypto.randomUUID(),
      provider: "dataforseo",
      fundingSource: "byok",
    };
    expect(
      await f.command(command, { secret: "synthetic-login:synthetic-password" }),
    ).toMatchObject({
      outcome: "success",
      revision: null,
      message: expect.stringContaining("Format validation only"),
    });
    expect(f.server.vault.list()).toEqual([]);
    expect(
      await f.command(
        { ...command, commandId: crypto.randomUUID() },
        { secret: "without-basic-separator" },
      ),
    ).toMatchObject({ outcome: "invalid", field: "secrets" });
    const connected = await f.connect();
    if (connected.outcome !== "success" || !connected.connection)
      throw new Error("Expected connection");
    expect(
      await f.command({
        kind: "test",
        commandId: crypto.randomUUID(),
        connectionId: connected.connection.id,
        expectedRevision: connected.connection.revision,
      }),
    ).toMatchObject({ outcome: "success" });
    for (const body of [
      null,
      { command: { ...command, rawKey: "synthetic-unexpected-key" } },
      { command, secrets: { secret: "ok", extra: "synthetic-unexpected-key" } },
      { command, binding: { principalKey: "admin" } },
    ])
      expect((await f.send("/providers/management/commands", body)).status).toBe(400);
    for (const query of [
      { kind: "connections", provider: 42 },
      { kind: "balance", connectionId: "c", secret: "synthetic-key" },
      {
        kind: "projection",
        connectionId: "c",
        operation: "search",
        quantity: 1,
        unit: "requests",
        surface: "app",
      },
      { kind: "allocations", connectionIds: ["c", "c"] },
    ])
      expect((await f.send("/providers/management/read", { query })).status).toBe(400);
    expect(f.transport).not.toHaveBeenCalled();
  } finally {
    await f.server.stop();
  }
});

test("simultaneous existing-row commands have exactly one CAS winner and token rotation fences old access", async () => {
  const f = await fixture();
  try {
    const connected = await f.connect();
    if (connected.outcome !== "success" || !connected.connection)
      throw new Error("Expected connection");
    const base = {
      kind: "reconnect" as const,
      connectionId: connected.connection.id,
      expectedRevision: connected.connection.revision,
    };
    const results = await Promise.all([
      f.command({ ...base, commandId: crypto.randomUUID() }, { secret: "synthetic-race-a" }),
      f.command({ ...base, commandId: crypto.randomUUID() }, { secret: "synthetic-race-b" }),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["conflict", "success"]);
    const winner = results.find((result) => result.outcome === "success")!;
    expect(winner.outcome === "success" && winner.connection?.revision).toBe(
      f.server.vault.describe()[0]!.revision,
    );
    const before = (await (
      await f.send("/providers/management/binding")
    ).json()) as ProviderBinding;
    const rotated = (await (await f.send("/token/rotate", {})).json()) as { token: string };
    expect((await f.send("/providers/management/binding")).status).toBe(401);
    expect(
      (
        await f.send("/providers/management/commands", {
          command: { ...base, commandId: crypto.randomUUID() },
        })
      ).status,
    ).toBe(401);
    const after = (await (
      await f.send("/providers/management/binding", undefined, rotated.token)
    ).json()) as ProviderBinding;
    expect(after.scopeKey).toBe(before.scopeKey);
    expect(after.authRevision).not.toBe(before.authRevision);
    expect(f.transport).not.toHaveBeenCalled();
  } finally {
    await f.server.stop();
  }
});
