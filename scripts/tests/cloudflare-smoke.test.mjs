import assert from "node:assert/strict";
import { test } from "node:test";
import { readSmokeResponse } from "../../examples/cloudflare-worker/smoke-response.mjs";

test("Cloudflare smoke preserves JSON results and authentication errors", async () => {
  for (const [status, body] of [
    [200, { outcome: "reserved", replayed: false }],
    [401, { error: "unauthorized" }],
    [403, { error: "forbidden" }],
  ]) {
    const response = Response.json(body, { status });
    assert.deepEqual(await readSmokeResponse(response, "POST /v1/operations/reserve"), {
      status,
      body,
    });
  }
});

test("Cloudflare smoke identifies the route, status and non-JSON runtime failure", async () => {
  for (const status of [200, 500]) {
    const response = new Response("Error: Network connection lost.", { status });
    await assert.rejects(readSmokeResponse(response, "POST /v1/operations/reserve"), (error) => {
      assert.match(error.message, /POST \/v1\/operations\/reserve/);
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.match(error.message, /Network connection lost/);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
  }
});
