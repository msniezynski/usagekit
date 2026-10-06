import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { readSmokeResponse } from "./smoke-response.mjs";

// Exercise the shipped entrypoint in wrangler dev, including a complete process restart.
const temp = mkdtempSync(join(tmpdir(), "usagekit-worker-smoke-"));
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const headers = { "content-type": "application/json", authorization: "Bearer local-smoke-fixture" };
let child;
let output = "";
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
    child = undefined;
  }
}
async function start() {
  output = "";
  child = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--local",
      "--config",
      "examples/cloudflare-worker/wrangler.jsonc",
      "--port",
      String(port),
      "--persist-to",
      temp,
      "--var",
      "USAGEKIT_TOKEN:local-smoke-fixture",
    ],
    {
      env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
      await response.text();
      if (response.status === 401) return;
    } catch {
      /* Startup only. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Worker did not start: ${output}`);
}
const call = async (route, body, customHeaders = headers) => {
  const response = await fetch(origin + route, {
    method: "POST",
    headers: customHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return readSmokeResponse(response, `POST ${route}`);
};
try {
  await start();
  const i = {
    commandId: "reserve-command",
    operationId: "smoke",
    scope: { namespace: "demo", principal: "demo-user", connection: "example" },
    fundingSource: "byok",
    costOwner: "demo-user",
    surface: "app",
    source: "app",
    provider: "example",
    operation: "search",
    estimate: [{ unit: "requests", value: "6", scale: 0 }],
  };
  assert.equal((await call("/v1/operations/reserve", i, {})).status, 401);
  assert.equal(
    (await call("/v1/operations/reserve", { ...i, scope: { ...i.scope, namespace: "other" } }))
      .status,
    403,
  );
  assert.equal(
    (await call("/v1/operations/reserve", { ...i, scope: { ...i.scope, principal: "other" } }))
      .status,
    403,
  );
  const reserve = await call("/v1/operations/reserve", i);
  assert.equal(reserve.status, 200);
  assert.equal(reserve.body.outcome, "reserved");
  assert.equal((await call("/v1/operations/reserve", i)).body.replayed, true);
  assert.equal(
    (await call("/v1/operations/reserve", { ...i, operationId: "denied" })).body.outcome,
    "exceeded",
  );
  const ref = { namespace: "demo", principal: "demo-user", operationId: i.operationId };
  const intent = await call("/v1/operations/intent", {
    ...ref,
    commandId: "intent",
    expectedVersion: reserve.body.operation.version,
    holder: "smoke",
    leaseTtlMs: 60000,
  });
  assert.equal(intent.body.granted, true);
  const now = new Date().toISOString();
  const settlement = {
    ...ref,
    commandId: "settle",
    expectedVersion: intent.body.operation.version,
    authority: { kind: "lease", leaseId: intent.body.lease.leaseId },
    receipt: {
      id: "receipt",
      occurredAt: now,
      recordedAt: now,
      cached: false,
      failed: false,
      measurements: [
        {
          unit: "requests",
          quantity: { value: "3", scale: 0, unit: "requests" },
          certainty: "measured",
        },
      ],
      cost: { certainty: "measured", money: { currency: "USD", units: "9007199254740993" } },
    },
  };
  assert.equal((await call("/v1/operations/settle", settlement)).body.outcome, "settled");
  await stop();
  await start();
  const q = Buffer.from(JSON.stringify(ref)).toString("base64url");
  const response = await fetch(`${origin}/v1/operations/${ref.operationId}?q=${q}`, { headers });
  const read = await response.json();
  assert.equal(response.status, 200);
  assert.equal(read.value.state, "settled");
  assert.equal(read.value.receipts[0].cost.money.units, "9007199254740993");
  assert.equal((await call("/v1/operations/settle", settlement)).body.replayed, true);
  // Used=3 survives process restart: reserving 8 must still be denied.
  assert.equal(
    (
      await call("/v1/operations/reserve", {
        ...i,
        operationId: "after-restart",
        estimate: [{ unit: "requests", value: "8", scale: 0 }],
      })
    ).body.outcome,
    "exceeded",
  );
  console.log(
    "Cloudflare example PASS: authentication, tenant scope, reserve/replay/deny, dispatch, exact settlement, restart and durable replay/projection.",
  );
} catch (error) {
  console.error(`Wrangler output before smoke failure:\n${output.slice(-8192)}`);
  throw error;
} finally {
  await stop();
  rmSync(temp, { recursive: true, force: true });
}
