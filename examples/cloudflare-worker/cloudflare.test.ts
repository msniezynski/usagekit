import { afterAll, expect, test } from "vitest";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runStoreConformance, runStoreScalingConformance } from "@usagekit/store/conformance";
import { createManualClock, InvalidInput } from "@usagekit/store";
import type { Store } from "@usagekit/store";
import type { Budget } from "@usagekit/core";
import type { SqlMetrics } from "../../packages/store-d1/src/index.js";
import { encode, decode } from "../../packages/store-d1/src/serialize.js";
import { input, budget, command, receipt, ref } from "../../packages/store/conformance/helpers.js";

const dir = mkdtempSync(join(tmpdir(), "usagekit-cloudflare-"));
let mf: Miniflare | undefined;
let bundle: string | undefined;
async function start() {
  if (!bundle) {
    const result = await build({
      entryPoints: ["examples/cloudflare-worker/test-worker.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["cloudflare:workers"],
      alias: {
        "@usagekit/core": resolve("packages/core/src/index.ts"),
        "@usagekit/store": resolve("packages/store/src/index.ts"),
      },
    });
    bundle = result.outputFiles[0]!.text;
  }
  if (!mf) {
    const gateway = `export default { fetch(request, env) { return env.LEDGER.getByName(new URL(request.url).pathname).fetch(request); } };`;
    mf = new Miniflare(
      convertV4MiniflareOptions({
        resourcePersistencePath: dir,
        workers: [
          ...["a", "b"].map((name) => ({
            name,
            modules: true,
            script: gateway,
            compatibilityDate: "2026-09-27",
            durableObjects: {
              LEDGER: { className: "TestLedger", scriptName: "ledger", useSQLite: true },
            },
          })),
          {
            name: "ledger",
            modules: true,
            script: bundle,
            compatibilityDate: "2026-09-27",
            durableObjects: { LEDGER: { className: "TestLedger", useSQLite: true } },
          },
        ],
      }),
    );
    await mf.ready;
  }
  return mf;
}
afterAll(async () => {
  await mf?.dispose();
  rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
  await start();
  const id = crypto.randomUUID(),
    clock = createManualClock(),
    budgets: Budget[] = [];
  let metrics: SqlMetrics = {
    statements: 0,
    changes: 0n,
    rowsRead: 0,
    storageRowsRead: 0,
    storageRowsWritten: 0,
  };
  const seen = new Map<string, string>();
  const call = async (method: string, args: unknown[] = [], worker = "a") => {
    const changed = budgets.filter(
      (b) => seen.get(`${b.scope.namespace}:${b.id}:${b.version}`) !== encode(b),
    );
    // Record before awaiting, so concurrent commands don't all rewrite fixtures.
    for (const b of changed) seen.set(`${b.scope.namespace}:${b.id}:${b.version}`, encode(b));
    // Miniflare 5 ReplaceWorkersTypes incorrectly collapses Fetcher to Request with DOM types.
    const gateway = (await (await start()).getWorker(worker)) as unknown as {
      fetch(url: string, init: RequestInit): Promise<Response>;
    };
    const response = await gateway.fetch(`http://test/${id}`, {
      method: "POST",
      body: encode({ method, args, now: clock.now().toISOString(), budgets: changed }),
    });
    if (!response.ok) throw new Error(await response.text());
    const payload = decode<{
      result?: unknown;
      metrics: SqlMetrics;
      error?: { field?: string; reason?: string; message: string };
    }>(await response.text());
    metrics = payload.metrics;
    if (payload.error) {
      if (payload.error.field) throw new InvalidInput(payload.error.field, payload.error.reason);
      throw new Error(payload.error.message);
    }
    return payload.result;
  };
  const store = new Proxy({} as Store, {
    get: (_, method) =>
      method === "then" ? undefined : (...args: unknown[]) => call(String(method), args),
  });
  await call("$metrics");
  return {
    store,
    clock,
    budgets,
    call,
    snapshot: () => ({ ...metrics }),
    readOnly: async (run: () => Promise<void>) => {
      await call("$readOnly", [true]);
      try {
        await run();
      } finally {
        await call("$readOnly", [false]);
      }
    },
    restart: async () => {
      await mf!.dispose();
      mf = undefined;
      await start();
      return store;
    },
    close: async () => {},
  };
}
runStoreConformance(fixture, {
  durable: true,
  rollingWindows: false,
  maxMoneyUnits: 2n ** 63n - 1n,
  maxQuantityScale: 18,
});
runStoreScalingConformance(async () => {
  const f = await fixture();
  f.budgets.push(budget({ limit: null }));
  await f.store.reserve(input({ operationId: "warmup" }));
  return f;
});

test("two independent Workers race on the same object and shared pool", async () => {
  const f = await fixture();
  f.budgets.push(
    budget({
      scope: { kind: "platform_pool", namespace: "test", poolId: "shared" },
      limit: { value: 1n, scale: 0, unit: "requests" },
    }),
  );
  await f.call("$metrics");
  const results = await Promise.all(
    ["a", "b"].map((worker) =>
      f.call(
        "reserve",
        [
          input({
            operationId: worker,
            scope: { namespace: "test", principal: worker, connection: worker },
            platformPools: ["shared"],
          }),
        ],
        worker,
      ),
    ),
  );
  expect(results.map((r) => (r as { outcome: string }).outcome).sort()).toEqual([
    "exceeded",
    "reserved",
  ]);
  const win = results.find((r) => (r as { outcome: string }).outcome === "reserved") as {
    operation: Parameters<typeof command>[0];
  };
  const intent = { ...command(win.operation), holder: "worker", leaseTtlMs: 1000 };
  const grants = await Promise.all(
    ["a", "b"].map((worker) => f.call("markDispatchIntent", [intent], worker)),
  );
  expect(grants.filter((g) => (g as { granted: boolean }).granted)).toHaveLength(1);
});

test("injected failure rolls back the operation, receipt, event, command and budget projection", async () => {
  const f = await fixture();
  f.budgets.push(budget());
  const reserved = await f.store.reserve(input());
  if (reserved.outcome !== "reserved") throw new Error("fixture");
  const grant = await f.store.markDispatchIntent({
    ...command(reserved.operation),
    holder: "h",
    leaseTtlMs: 1000,
  });
  if (!("granted" in grant) || !grant.granted) throw new Error("fixture");
  const settle = {
    ...command(grant.operation),
    authority: { kind: "lease" as const, leaseId: grant.lease.leaseId },
    receipt: receipt(),
  };
  const query = { scope: reserved.operation.scope, surface: "app" as const, units: ["requests"] };
  const before = await f.store.applicableBudgets(query);
  await f.call("$failWrite", [true]);
  await expect(f.store.settle(settle)).rejects.toThrow("injected write failure");
  expect(await f.store.getOperation(ref(reserved.operation))).toEqual(grant.operation);
  expect(await f.store.applicableBudgets(query)).toEqual(before);
  await f.call("$failWrite", [false]);
  expect(await f.store.settle(settle)).toMatchObject({ outcome: "settled" });
  await f.restart();
  expect(await f.store.getOperation(ref(reserved.operation))).toMatchObject({
    state: "settled",
    receipts: [settle.receipt],
  });
});

test("budget versions are immutable across workers and seeded definitions survive activation", async () => {
  const f = await fixture();
  const b = budget();
  await f.call("$seedReopen", [[b]]);
  await f.call("$seedReopen", [[b]]);
  await expect(f.call("$seedReopen", [[{ ...b, limit: null }]])).rejects.toThrow("immutable");
  const next = { ...b, version: 2, limit: null };
  const results = await Promise.all(
    ["a", "b"].map((worker) => f.call("putBudget", [next], worker)),
  );
  expect(results.map((r) => (r as { outcome: string }).outcome).sort()).toEqual([
    "conflict",
    "saved",
  ]);
  await f.restart();
  expect(await f.call("listBudgets")).toEqual([next]);
});

test("signed usage cursors survive process restart and reject tampering", async () => {
  const f = await fixture();
  for (const provider of ["a", "b"]) {
    const r = await f.store.reserve(input({ provider }));
    if (r.outcome !== "reserved") throw new Error("fixture");
    const g = await f.store.markDispatchIntent({
      ...command(r.operation),
      holder: "h",
      leaseTtlMs: 1000,
    });
    if (!("granted" in g) || !g.granted) throw new Error("fixture");
    await f.store.settle({
      ...command(g.operation),
      authority: { kind: "lease", leaseId: g.lease.leaseId },
      receipt: receipt(),
    });
  }
  const q = {
    scope: { kind: "namespace" as const, namespace: "test" },
    from: "2026-09-01T00:00:00Z",
    to: "2026-10-01T00:00:00Z",
    units: ["requests"],
    groupBy: ["provider" as const],
    limit: 1,
  };
  const first = await f.store.aggregate(q);
  expect(first.nextCursor).toBeTruthy();
  await f.restart();
  const second = await f.store.aggregate({ ...q, cursor: first.nextCursor! });
  expect(second.watermark).toBe(first.watermark);
  expect(second.rows).toHaveLength(1);
  expect(second.rows).not.toEqual(first.rows);
  await expect(f.store.aggregate({ ...q, cursor: first.nextCursor! + "x" })).rejects.toThrow(
    "cursor",
  );
});
