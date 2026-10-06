import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const dir = "examples/cloudflare-worker/remote/.state";
const deployment = JSON.parse(readFileSync(`${dir}/deployment.json`, "utf8"));
const secret = JSON.parse(readFileSync(`${dir}/secrets.json`, "utf8")).USAGEKIT_TOKEN;
const mode = process.argv[2] ?? "before";
const encode = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? { $bigint: String(v) } : v));
const decode = (text) =>
  JSON.parse(text, (_, v) =>
    v && typeof v === "object" && Object.keys(v).length === 1 && typeof v.$bigint === "string"
      ? BigInt(v.$bigint)
      : v,
  );
const report =
  mode === "after"
    ? JSON.parse(readFileSync(`${dir}/report.json`, "utf8"))
    : {
        startedAt: new Date().toISOString(),
        account: deployment.account,
        urls: [deployment.workers.a.url, deployment.workers.b.url],
        initialVersions: deployment.workers,
        checks: [],
        requests: 0,
        rays: [],
        latencyMs: [],
      };
let checkpoints = mode === "after" ? decode(readFileSync(`${dir}/checkpoints.json`, "utf8")) : {};
const now = "2026-09-27T12:00:00.000Z";
const run = (label) => `p7-${label}-${crypto.randomUUID()}`;
const q = (value) => ({ unit: "requests", value: BigInt(value), scale: 0 });
const input = (namespace, id = crypto.randomUUID(), principal = "a", amount = 1) => ({
  operationId: id,
  scope: { namespace, principal, connection: "connection" },
  fundingSource: "byok",
  costOwner: principal,
  surface: "app",
  source: "app",
  provider: "example",
  operation: "search",
  estimate: [q(amount)],
  platformPools: ["shared"],
});
const ref = (op) => ({
  namespace: op.scope.namespace,
  principal: op.scope.principal,
  operationId: op.operationId,
});
const command = (op) => ({
  ...ref(op),
  commandId: crypto.randomUUID(),
  expectedVersion: op.version,
});
const receipt = (amount = 1, money = 1n) => ({
  id: crypto.randomUUID(),
  occurredAt: now,
  recordedAt: now,
  cached: false,
  failed: false,
  measurements: [{ unit: "requests", quantity: q(amount), certainty: "measured" }],
  cost: { certainty: "measured", money: { currency: "USD", units: money } },
});
async function request(worker, path, options = {}) {
  const start = performance.now();
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(deployment.workers[worker].url + path, {
        ...options,
        headers: { authorization: `Bearer ${secret}`, ...options.headers },
        signal: AbortSignal.timeout(30000),
      });
      break;
    } catch (error) {
      (report.transportErrors ??= []).push({
        worker,
        path,
        attempt: attempt + 1,
        error: error.cause?.code ?? error.name,
      });
      if (attempt === 2) throw error;
      // Retry the SAME serialized command, never generate a new accounting identity.
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  const text = await response.text();
  report.requests++;
  report.latencyMs.push(Math.round((performance.now() - start) * 100) / 100);
  const ray = response.headers.get("cf-ray");
  if (ray) report.rays.push(ray);
  return { status: response.status, text };
}
async function raw(namespace, method, value, worker = "a", extra = {}) {
  const response = await request(worker, "/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: encode({ run: namespace, method, input: value, now, ...extra }),
  });
  assert.equal(response.status, 200, `HTTP ${response.status}: ${response.text}`);
  return decode(response.text);
}
async function call(namespace, method, value, worker = "a", extra = {}) {
  const body = await raw(namespace, method, value, worker, extra);
  if (body.error) throw new Error(body.error.message);
  return method === "inspect" ? body : body.result;
}
const budget = async (namespace, limit = 1) => {
  const b = {
    id: "pool",
    version: 1,
    scope: { kind: "platform_pool", namespace, poolId: "shared" },
    surface: "any",
    unit: "requests",
    limit: q(limit),
    window: { kind: "calendar_month", timezone: "UTC" },
    onExceed: "block",
  };
  assert.equal((await call(namespace, "putBudget", b)).outcome, "saved");
  return b;
};
const status = (namespace, principal = "a") =>
  call(namespace, "applicableBudgets", {
    scope: input(namespace, "unused", principal).scope,
    surface: "app",
    units: ["requests"],
    platformPools: ["shared"],
  });
async function dispatch(namespace, reservation) {
  assert.equal(reservation.outcome, "reserved");
  const grant = await call(namespace, "markDispatchIntent", {
    ...command(reservation.operation),
    holder: "test",
    leaseTtlMs: 1000,
  });
  assert.equal(grant.granted, true);
  return grant;
}
const settlement = (grant, r = receipt()) => ({
  ...command(grant.operation),
  authority: { kind: "lease", leaseId: grant.lease.leaseId },
  receipt: r,
});
const query = (namespace) => ({
  scope: { kind: "namespace", namespace },
  from: "2026-09-01T00:00:00Z",
  to: "2026-10-01T00:00:00Z",
  units: ["requests"],
  groupBy: ["provider"],
  limit: 1,
});
function save() {
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(`${dir}/checkpoints.json`, encode(checkpoints));
}
const passed = (name, evidence = {}) => {
  report.checks.push({ name, ...evidence });
  save();
  console.log(`PASS ${name}`);
};
try {
  if (mode === "before") {
    for (const worker of ["a", "b"]) {
      assert.equal(
        (await request(worker, "/health", { headers: { authorization: "" } })).status,
        401,
      );
      assert.equal(
        (await request(worker, "/health", { headers: { authorization: "Bearer wrong" } })).status,
        401,
      );
      const health = await request(worker, "/health");
      assert.equal(health.status, 200);
      assert.equal(JSON.parse(health.text).gateway, worker);
    }
    const invalid = await request("a", "/test", {
      method: "POST",
      body: encode({ run: "p7-valid", method: "reserve", input: input("other"), now }),
    });
    assert.equal(invalid.status, 403);
    passed("Both deployed gateways authenticate and reject cross-namespace input");

    for (let round = 0; round < 20; round++) {
      const ns = run("race");
      await budget(ns);
      const attempts = [input(ns, "a", "a"), input(ns, "b", "b")];
      const results = await Promise.all(
        attempts.map((i, n) => call(ns, "reserve", i, n ? "b" : "a")),
      );
      assert.deepEqual(results.map((r) => r.outcome).sort(), ["exceeded", "reserved"]);
      const winner = results.find((r) => r.outcome === "reserved");
      const intent = { ...command(winner.operation), holder: "racer", leaseTtlMs: 1000 };
      const grants = await Promise.all(
        ["a", "b"].map((w) => call(ns, "markDispatchIntent", intent, w)),
      );
      assert.equal(grants.filter((g) => g.granted).length, 1);
      const settle = settlement(grants.find((g) => g.granted));
      const settlements = await Promise.all(["a", "b"].map((w) => call(ns, "settle", settle, w)));
      assert.equal(settlements.filter((s) => s.replayed).length, 1);
      assert.equal((await status(ns, winner.operation.scope.principal))[0].used.value, 1n);
    }
    passed("Two deployed Workers: 20 shared-pool races, exactly one admission and dispatch each", {
      rounds: 20,
      duplicateSettlements: 0,
    });

    const load = run("load");
    await budget(load, 25);
    const loadStart = performance.now();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        call(load, "reserve", input(load, String(i), i % 2 ? "b" : "a"), i % 2 ? "b" : "a"),
      ),
    );
    assert.equal(results.filter((r) => r.outcome === "reserved").length, 25);
    assert.equal(results.filter((r) => r.outcome === "exceeded").length, 75);
    assert.equal((await status(load))[0].reserved.value, 25n);
    passed("100 concurrent requests respect a shared limit of 25", {
      admitted: 25,
      denied: 75,
      elapsedMs: Math.round(performance.now() - loadStart),
    });

    const ns = run("atomic");
    const b = await budget(ns, 10);
    const reserved = await call(ns, "reserve", input(ns, "operation", "a", 3));
    const grant = await dispatch(ns, reserved);
    const settle = settlement(grant, receipt(2, 9007199254740993n));
    const before = await status(ns);
    const failure = await raw(ns, "settle", settle, "a", { failBeforeCommit: true });
    assert.match(failure.error.message, /injected before commit/);
    assert.deepEqual(await call(ns, "getOperation", ref(grant.operation)), grant.operation);
    assert.deepEqual(await status(ns), before);
    const listed = await call(ns, "listOperations", {
      scope: { kind: "namespace", namespace: ns },
      from: query(ns).from,
      to: query(ns).to,
      states: ["settled"],
    });
    assert.equal(listed.operations.length, 0);
    assert.equal((await call(ns, "settle", settle)).replayed, false);
    assert.equal((await call(ns, "settle", settle, "b")).replayed, true);
    assert.equal((await status(ns))[0].used.value, 2n);
    assert.equal((await status(ns))[0].reserved.value, 0n);
    const op = await call(ns, "getOperation", ref(grant.operation));
    assert.equal(op.receipts.length, 1);
    assert.equal(op.receipts[0].cost.money.units, 9007199254740993n);
    checkpoints.atomic = {
      ns,
      settle,
      ref: ref(grant.operation),
      instance: (await call(ns, "inspect")).instance,
    };
    passed(
      "Failure after all writes rolls back journal, event, receipt and projection; retry settles exactly once",
      { exactMoneyUnits: "9007199254740993" },
    );
    const next = { ...b, version: 2, limit: q(12) };
    const versions = await Promise.all(["a", "b"].map((w) => call(ns, "putBudget", next, w)));
    assert.deepEqual(versions.map((v) => v.outcome).sort(), ["conflict", "saved"]);
    passed("Concurrent budget version update has one winner");

    const expiry = run("expiry");
    await budget(expiry, 10);
    const abandoned = await call(expiry, "reserve", {
      ...input(expiry, "abandoned"),
      reservationTtlMs: 1000,
    });
    const active = await dispatch(
      expiry,
      await call(expiry, "reserve", { ...input(expiry, "dispatched"), reservationTtlMs: 1000 }),
    );
    await call(expiry, "expireReservations", { namespace: expiry }, "a", {
      now: "2026-09-27T12:00:02Z",
    });
    assert.equal((await call(expiry, "getOperation", ref(abandoned.operation))).state, "released");
    assert.equal(
      (await call(expiry, "getOperation", ref(active.operation))).state,
      "dispatch_intended",
    );
    checkpoints.recovery = { ns: expiry, ref: ref(active.operation) };
    passed("Expiry releases only undispatched reservations");

    const cursorNs = run("cursor");
    for (const provider of ["a", "b"]) {
      const g = await dispatch(
        cursorNs,
        await call(cursorNs, "reserve", { ...input(cursorNs), provider }),
      );
      await call(cursorNs, "settle", settlement(g));
    }
    const first = await call(cursorNs, "aggregate", query(cursorNs));
    assert.ok(first.nextCursor);
    checkpoints.cursor = { ns: cursorNs, first };
    passed("Persisted cursor checkpoint prepared");

    const wire = (value) =>
      JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v));
    const httpInput = {
      ...input("demo", crypto.randomUUID(), "demo-user"),
      commandId: crypto.randomUUID(),
    };
    const http = async (path, value, worker = "a") => {
      const r = await request(worker, path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: wire(value),
      });
      assert.equal(r.status, 200, r.text);
      return JSON.parse(r.text);
    };
    const r = await http("/v1/operations/reserve", httpInput);
    assert.equal(r.outcome, "reserved");
    assert.equal((await http("/v1/operations/reserve", httpInput, "b")).replayed, true);
    assert.equal(
      (
        await http("/v1/operations/reserve", {
          ...httpInput,
          operationId: crypto.randomUUID(),
          estimate: [q(11)],
        })
      ).outcome,
      "exceeded",
    );
    const g = await http("/v1/operations/intent", {
      ...command(r.operation),
      holder: "http",
      leaseTtlMs: 60000,
    });
    assert.equal(g.granted, true);
    const httpSettle = settlement(g, receipt(1, 9007199254740993n));
    assert.equal((await http("/v1/operations/settle", httpSettle)).outcome, "settled");
    checkpoints.http = { ref: ref(r.operation), settlement: httpSettle };
    passed("Unchanged shipped HTTP example works remotely through both gateways");
    report.beforeCompletedAt = new Date().toISOString();
  } else if (mode === "after") {
    const a = checkpoints.atomic;
    let inspected;
    const rolloutStart = performance.now();
    for (let attempt = 0; attempt < 40; attempt++) {
      inspected = await call(a.ns, "inspect");
      if (inspected.revision === deployment.revision) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    report.rolloutWaitMs = Math.round(performance.now() - rolloutStart);
    assert.equal(inspected.revision, deployment.revision);
    assert.notEqual(inspected.instance, a.instance);
    assert.equal((await call(a.ns, "settle", a.settle)).replayed, true);
    assert.equal(
      (await call(a.ns, "getOperation", a.ref)).receipts[0].cost.money.units,
      9007199254740993n,
    );
    assert.equal((await status(a.ns))[0].used.value, 2n);
    assert.equal((await status(a.ns))[0].budget.version, 2);
    passed(
      "Redeploy reconstructed the object; exact amount, journal, budget version and usage survived",
      {
        beforeInstance: a.instance,
        afterInstance: inspected.instance,
        revision: inspected.revision,
      },
    );
    const c = checkpoints.cursor;
    const next = await call(c.ns, "aggregate", { ...query(c.ns), cursor: c.first.nextCursor });
    assert.equal(next.watermark, c.first.watermark);
    assert.equal(next.rows.length, 1);
    assert.notDeepEqual(next.rows, c.first.rows);
    const bad = await raw(c.ns, "aggregate", { ...query(c.ns), cursor: c.first.nextCursor + "x" });
    assert.equal(bad.error.field, "cursor");
    passed("Signed cursor survives redeploy and rejects tampering");
    const r = checkpoints.recovery;
    const recovery = await call(
      r.ns,
      "claimForRecovery",
      { ...r.ref, holder: "after-redeploy", leaseTtlMs: 1000 },
      "b",
      { now: "2026-09-27T12:00:05Z" },
    );
    assert.equal(recovery.claimed, true);
    const result = await call(
      r.ns,
      "settle",
      {
        ...command(recovery.operation),
        authority: { kind: "recovery", leaseId: recovery.lease.leaseId },
        receipt: receipt(),
      },
      "b",
      { now: "2026-09-27T12:00:05Z" },
    );
    assert.equal(result.outcome, "settled");
    const secondDispatch = await call(r.ns, "markDispatchIntent", {
      ...command(result.operation),
      holder: "again",
      leaseTtlMs: 1000,
    });
    assert.equal(secondDispatch.granted, false);
    passed("Recovery after redeploy settles old dispatch without a second dispatch grant");
    const h = checkpoints.http;
    const encoded = Buffer.from(JSON.stringify(h.ref)).toString("base64url");
    const response = await request("b", `/v1/operations/${h.ref.operationId}?q=${encoded}`);
    assert.equal(response.status, 200);
    const read = JSON.parse(response.text);
    assert.equal(read.value.state, "settled");
    assert.equal(read.value.receipts[0].cost.money.units, "9007199254740993");
    passed("Unchanged HTTP example data survives redeploy");
    if (report.failure) {
      (report.observations ??= []).push({ earlierAttempt: report.failure });
      delete report.failure;
    }
    report.completedAt = new Date().toISOString();
    report.finalVersions = deployment.workers;
  } else throw new Error("Use before or after");
  const times = [...report.latencyMs].sort((a, b) => a - b);
  report.latency = {
    measuredFrom: "operator machine; includes network and client scheduling",
    samples: times.length,
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    max: times.at(-1),
  };
  report.edgeLocations = [...new Set(report.rays.map((ray) => ray.split("-").at(-1)))];
  save();
  console.log(
    JSON.stringify(
      {
        phase: mode,
        checks: report.checks.length,
        requests: report.requests,
        latency: report.latency,
        edgeLocations: report.edgeLocations,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = String(error);
  save();
  throw error;
}
