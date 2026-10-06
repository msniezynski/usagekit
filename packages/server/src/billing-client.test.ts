import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { AccessContext, BillingImportInput, Cost, Receipt } from "@usagekit/core";
import type { Store } from "@usagekit/store";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createSqliteStore } from "@usagekit/store-sqlite";
import { createMeter } from "@usagekit/meter";
import { createUsageHandlers } from "@usagekit/http";
import { dataforseo, parseBillingExport } from "@usagekit/providers";
import { createRemoteMeter, RemoteHttpError, RemoteUnavailable } from "@usagekit/client";

const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["u"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: true,
  canImportBilling: true,
};
const input: BillingImportInput = {
  scope: { namespace: "test", principal: "u", connection: "c" },
  provider: "example",
  fileHash: "a".repeat(64),
  window: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
  expectedPreviousImportId: null,
  attribution: { fundingSource: "byok", costOwner: "u" },
  lines: [
    {
      providerRequestId: "provider-1",
      operation: "search",
      occurredAt: "2026-09-23T12:00:00.000Z",
      cost: { units: 1200n, currency: "USD" },
    },
  ],
};
const query = { scope: { namespace: "test", principal: "u" }, connection: "c", ...input.window };
function fixture(kind: "memory" | "sqlite") {
  const clock = createManualClock(),
    dir = kind === "sqlite" ? mkdtempSync(join(tmpdir(), "usagekit-billing-remote-")) : undefined;
  let store: Store =
    kind === "sqlite"
      ? createSqliteStore({ path: join(dir!, "usage.db"), clock })
      : createMemoryStore({ clock, budgets: [] });
  let auth = access,
    commands = true,
    drop = false,
    requests = 0;
  const bodies: string[] = [];
  const configure = () => {
    const meter = createMeter({
      store,
      clock,
      resolveOwnership: async (scope) =>
        scope.namespace === "test" && "connection" in scope && scope.connection === "c"
          ? { kind: "principal", namespace: "test", principal: "u" }
          : null,
    });
    const dispatch = vi.spyOn(meter, "markDispatchIntent");
    const handler = createUsageHandlers({ meter, commands, authenticate: async () => auth });
    const remote = createRemoteMeter({
      baseUrl: "http://local.test",
      token: "verified-token",
      fetch: async (url, init) => {
        requests++;
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer verified-token");
        if (init?.body) {
          bodies.push(String(init.body));
          expect(String(init.body)).not.toContain("canImportBilling");
        }
        const response = await handler(new Request(url, init));
        if (drop) {
          drop = false;
          throw new Error("lost response");
        }
        return response;
      },
    });
    return { meter, dispatch, remote };
  };
  let current = configure();
  return {
    clock,
    bodies,
    get store() {
      return store;
    },
    get remote() {
      return current.remote;
    },
    get dispatch() {
      return current.dispatch;
    },
    get requests() {
      return requests;
    },
    loseResponse() {
      drop = true;
    },
    authenticate(next: AccessContext) {
      auth = next;
    },
    readonly() {
      commands = false;
      current = configure();
    },
    restart() {
      if (kind !== "sqlite") throw new Error("SQLite required");
      (store as ReturnType<typeof createSqliteStore>).close();
      store = createSqliteStore({ path: join(dir!, "usage.db"), clock });
      current = configure();
    },
    close() {
      if (kind === "sqlite") (store as ReturnType<typeof createSqliteStore>).close();
      if (dir) rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function observe(
  store: Store,
  id: string,
  providerRequestId: string,
  cost: Cost,
  operation = "search",
) {
  const reserved = await store.reserve({
    operationId: id,
    scope: input.scope,
    fundingSource: "byok",
    costOwner: "u",
    surface: "app",
    source: "app",
    provider: "example",
    operation,
    estimate: [],
  });
  if (reserved.outcome !== "reserved") throw new Error("reserve fixture");
  const ref = { namespace: "test", principal: "u", operationId: id };
  const grant = await store.markDispatchIntent({
    ...ref,
    commandId: `intent-${id}`,
    expectedVersion: reserved.operation.version,
    holder: "h",
    leaseTtlMs: 1000,
  });
  if (!("granted" in grant) || !grant.granted) throw new Error("grant fixture");
  const receipt: Receipt = {
    id: `receipt-${id}`,
    providerRequestId,
    measurements: [],
    cost,
    occurredAt: "2026-09-23T12:00:00.000Z",
    recordedAt: "2026-09-23T12:00:00.000Z",
    cached: false,
    failed: false,
  };
  await store.settle({
    ...ref,
    commandId: `settle-${id}`,
    expectedVersion: grant.operation.version,
    authority: { kind: "lease", leaseId: grant.lease.leaseId },
    receipt,
  });
}

describe.each(["memory", "sqlite"] as const)("remote billing import over %s", (kind) => {
  test("a lost response needs explicit identical-body retry; revisions append and never dispatch", async () => {
    const f = fixture(kind);
    try {
      f.loseResponse();
      await expect(f.remote.importBilling(access, input)).rejects.toMatchObject({
        name: "RemoteUnavailable",
        requestId: input.fileHash,
      });
      expect(f.requests).toBe(1);
      const imported = await f.remote.importBilling(access, input);
      expect(imported).toMatchObject({ outcome: "imported", replayed: true });
      expect(f.bodies[0]).toBe(f.bodies[1]);
      if (imported.outcome !== "imported") throw new Error("import fixture");
      expect(imported.record.unobservedOperationIds).toHaveLength(1);
      const opId = imported.record.unobservedOperationIds[0]!;
      const operation = await f.remote.getOperation(access, {
        namespace: "test",
        principal: "u",
        operationId: opId,
      });
      expect(operation).toMatchObject({
        outcome: "ok",
        value: { state: "pending", source: "import", surface: "programmatic", lease: null },
      });
      if (operation.outcome !== "ok" || !operation.value) throw new Error("operation fixture");
      expect(operation.value.receipts.at(-1)?.cost).toEqual({
        certainty: "measured",
        money: { units: 1200n, currency: "USD" },
      });
      expect(operation.value.receipts.at(-1)?.measurements).toEqual(
        expect.arrayContaining([{ unit: "requests", certainty: "unknown", quantity: null }]),
      );
      expect(f.dispatch).not.toHaveBeenCalled();
      const revision = {
        ...input,
        fileHash: "b".repeat(64),
        expectedPreviousImportId: imported.record.id,
        lines: [{ ...input.lines[0]!, cost: { units: 900n, currency: "USD" as const } }],
      };
      const updated = await f.remote.importBilling(access, revision);
      expect(updated).toMatchObject({
        outcome: "imported",
        replayed: false,
        record: { supersedes: imported.record.id },
      });
      expect(
        await f.remote.importBilling(access, {
          ...input,
          lines: [{ ...input.lines[0]!, cost: { units: 900n, currency: "USD" } }],
        }),
      ).toMatchObject({ outcome: "rejected", reason: "payload_conflict" });
      expect(
        await f.remote.importBilling(access, {
          ...revision,
          fileHash: "c".repeat(64),
          expectedPreviousImportId: null,
        }),
      ).toMatchObject({ outcome: "rejected", reason: "previous_import_conflict" });
      const page = await f.remote.billingImports(access, { ...query, history: true });
      expect(page).toMatchObject({
        outcome: "ok",
        value: { records: expect.any(Array), truncated: false },
      });
      if (page.outcome !== "ok") throw new Error("page fixture");
      expect(page.value.records).toHaveLength(2);
      expect(page.value.records.find((r) => r.id === imported.record.id)?.supersededBy).toBe(
        updated.outcome === "imported" ? updated.record.id : "bad",
      );
      const latest = await f.remote.getOperation(access, {
        namespace: "test",
        principal: "u",
        operationId: opId,
      });
      if (latest.outcome !== "ok" || !latest.value) throw new Error("updated operation fixture");
      expect(latest.value.receipts).toHaveLength(2);
      expect(latest.value.receipts.at(-1)?.cost).toEqual({
        certainty: "measured",
        money: { units: 900n, currency: "USD" },
      });
      expect(f.dispatch).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  });

  test("aggregate comparison keeps negative exact differences and unknown cost remains null", async () => {
    const f = fixture(kind);
    try {
      await observe(f.store, "known", "observed-1", {
        certainty: "measured",
        money: { units: 9007199254740993n, currency: "USD" },
      });
      await observe(
        f.store,
        "other-operation",
        "observed-other",
        { certainty: "measured", money: { units: 10n, currency: "USD" } },
        "other",
      );
      const aggregate = {
        ...input,
        lines: [
          {
            occurredAt: input.window.from,
            operation: "search",
            window: input.window,
            cost: { units: 9007199254740992n, currency: "USD" as const },
          },
        ],
      };
      const imported = await f.remote.importBilling(access, aggregate);
      if (imported.outcome !== "imported") throw new Error(JSON.stringify(imported));
      expect(imported.record.unobservedOperationIds).toEqual([]);
      expect(imported.record.reconciliations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "aggregate",
            operation: "search",
            differenceUnits: -1n,
            unknownOperations: 0n,
          }),
        ]),
      );
      await observe(f.store, "unknown", "observed-2", { certainty: "unknown", money: null });
      const revised = await f.remote.importBilling(access, {
        ...aggregate,
        fileHash: "b".repeat(64),
        expectedPreviousImportId: imported.record.id,
      });
      if (revised.outcome !== "imported") throw new Error(JSON.stringify(revised));
      expect(revised.record.reconciliations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ledgerTotal: { certainty: "unknown", money: null },
            differenceUnits: null,
            unknownOperations: 1n,
          }),
        ]),
      );
      expect(f.dispatch).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  });

  test("server authorization wins over caller context and read-only mounts forbid imports", async () => {
    const f = fixture(kind);
    try {
      f.authenticate({ ...access, canImportBilling: false });
      expect(await f.remote.importBilling(access, input)).toEqual({ outcome: "forbidden" });
      expect(await f.store.billingImports(query)).toMatchObject({ records: [] });
      f.authenticate(access);
      expect(
        await f.remote.importBilling(access, {
          ...input,
          scope: { ...input.scope, connection: "unowned" },
        }),
      ).toEqual({ outcome: "forbidden" });
      f.readonly();
      await expect(f.remote.importBilling(access, input)).rejects.toBeInstanceOf(RemoteHttpError);
      await expect(f.remote.importBilling(access, input)).rejects.toMatchObject({ status: 404 });
      expect(await f.remote.billingImports(access, query)).toMatchObject({
        outcome: "ok",
        value: { records: [] },
      });
      f.authenticate({ ...access, canReadBillingDetail: false });
      expect(await f.remote.billingImports(access, query)).toEqual({ outcome: "forbidden" });
    } finally {
      f.close();
    }
  });
});

test("SQLite restart retains imported evidence, exact costs and replay identity through remote Meter", async () => {
  const f = fixture("sqlite");
  try {
    const imported = await f.remote.importBilling(access, input);
    expect(imported).toMatchObject({ outcome: "imported", replayed: false });
    f.restart();
    expect(await f.remote.importBilling(access, input)).toMatchObject({
      outcome: "imported",
      replayed: true,
    });
    const page = await f.remote.billingImports(access, query);
    expect(page).toMatchObject({
      outcome: "ok",
      value: { records: [{ id: imported.outcome === "imported" ? imported.record.id : "bad" }] },
    });
  } finally {
    f.close();
  }
});

test("billing import never automatically retries a failed transport", async () => {
  const fetcher = vi.fn(async () => {
    throw new Error("disconnected");
  });
  const remote = createRemoteMeter({
    baseUrl: "http://local.test",
    token: "token",
    fetch: fetcher,
  });
  await expect(remote.importBilling(access, input)).rejects.toBeInstanceOf(RemoteUnavailable);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("an advertised task-history export crosses the remote boundary as content-free exact evidence", async () => {
  const f = fixture("sqlite");
  try {
    f.clock.set("2026-09-30T00:00:00.000Z");
    const historyFixture = JSON.parse(
      readFileSync(
        new URL(
          "../../providers/src/dataforseo/fixtures/serp.google.organic.task_get.advanced/resolves-task-post.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const parsed = await parseBillingExport(
      dataforseo,
      JSON.stringify(historyFixture.response.body),
    );
    const imported = await f.remote.importBilling(access, { ...input, ...parsed });
    if (imported.outcome !== "imported") throw new Error(JSON.stringify(imported));
    const operation = await f.remote.getOperation(access, {
      namespace: "test",
      principal: "u",
      operationId: imported.record.unobservedOperationIds[0]!,
    });
    expect(operation).toMatchObject({
      outcome: "ok",
      value: {
        provider: "dataforseo",
        operation: "serp.google.organic.task_post",
        source: "import",
      },
    });
    if (operation.outcome !== "ok" || !operation.value) throw new Error("parsed import fixture");
    expect(operation.value.receipts.at(-1)?.cost).toEqual({
      certainty: "measured",
      money: { units: 1200n, currency: "USD" },
    });
    const exactMaximum = await parseBillingExport(
      dataforseo,
      JSON.stringify(historyFixture.response.body).replace(
        '"cost":0.0012',
        '"cost":9223372036854.775807',
      ),
    );
    expect(exactMaximum.lines[0]?.cost.units).toBe(2n ** 63n - 1n);
    expect(
      await f.remote.importBilling(access, {
        ...input,
        ...exactMaximum,
        expectedPreviousImportId: imported.record.id,
      }),
    ).toMatchObject({ outcome: "imported", replayed: false });
    f.restart();
    const maximumOperation = await f.remote.getOperation(access, {
      namespace: "test",
      principal: "u",
      operationId: imported.record.unobservedOperationIds[0]!,
    });
    if (maximumOperation.outcome !== "ok" || !maximumOperation.value)
      throw new Error("maximum import fixture");
    expect(maximumOperation.value.receipts.at(-1)?.cost).toEqual({
      certainty: "measured",
      money: { units: 2n ** 63n - 1n, currency: "USD" },
    });
    expect(f.bodies[0]).not.toContain("espresso machine");
    expect(f.dispatch).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});
