import assert from "node:assert/strict";
import { Pool } from "pg";
import { createManualClock } from "@usagekit/store";
import { createPostgresStore, migratePostgresStore } from "@usagekit/store-postgres";

const url = new URL(process.env.USAGEKIT_POSTGRES_TEST_URL ?? "invalid:missing");
const schema = process.env.USAGEKIT_POSTGRES_RESTART_SCHEMA ?? "";
assert(["127.0.0.1", "localhost", "postgres"].includes(url.hostname));
assert.equal(url.pathname, "/usagekit_store_fixture");
assert.match(schema, /^uk_restart_[a-f0-9]+$/);
const pool = new Pool({ connectionString: url.href });
try {
  if (process.argv[2] === "cleanup") {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } else {
    const clock = createManualClock();
    const ref = { namespace: "restart", principal: "owner", operationId: "durable" };
    if (process.argv[2] === "prepare")
      await migratePostgresStore({ pool, schema, createSchema: true });
    const store = await createPostgresStore({
      pool,
      schema,
      clock,
      ...(process.argv[2] === "crash"
        ? {
            testHooks: {
              afterOperationWrite: () => process.kill(process.pid, "SIGKILL"),
            },
          }
        : {}),
    });
    const intent = {
      ...ref,
      expectedVersion: 1,
      commandId: "intent",
      holder: "worker",
      leaseTtlMs: 1000,
    };
    if (["prepare", "crash"].includes(process.argv[2])) {
      const reserved = await store.reserve({
        operationId: process.argv[2] === "crash" ? "crashed" : ref.operationId,
        scope: { namespace: ref.namespace, principal: ref.principal, connection: "connection" },
        source: "app",
        surface: "app",
        provider: "fixture",
        operation: "request",
        fundingSource: "byok",
        costOwner: "owner",
        estimate: [{ unit: "requests", value: 1n, scale: 0 }],
      });
      assert.equal(reserved.outcome, "reserved");
      assert.equal(process.argv[2], "prepare", "crash injection did not kill the child");
      assert.equal((await store.markDispatchIntent(intent)).granted, true);
    } else {
      assert.equal(process.argv[2], "verify");
      assert.equal((await store.getOperation(ref))?.state, "dispatch_intended");
      assert.equal(await store.getOperation({ ...ref, operationId: "crashed" }), null);
      const replay = await store.markDispatchIntent(intent);
      assert.equal(replay.granted, false);
      assert.equal(replay.reason, "already_dispatched");
      clock.advance(1001);
      await store.expireReservations({ namespace: ref.namespace });
      assert.equal((await store.getOperation(ref))?.state, "dispatch_intended");
      console.log(
        "Postgres restart and SIGKILL PASS: committed journal retained, incomplete transaction rolled back, no second dispatch grant.",
      );
    }
  }
} finally {
  await pool.end();
}
