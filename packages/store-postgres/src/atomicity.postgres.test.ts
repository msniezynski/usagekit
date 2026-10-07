import { expect, test } from "vitest";
import {
  createPostgresStore,
  createTransactionBoundStore,
  migratePostgresStore,
  nodePostgresExecutor,
} from "./index.js";
import { bound, command, fixture, request } from "./test-fixture.js";

test("independent pools admit exactly one operation per shared budget in twenty epochs", async () => {
  const f = await fixture(),
    pool = f.connect();
  try {
    const other = await createPostgresStore({ pool, schema: f.schema, clock: f.clock });
    for (let epoch = 1; epoch <= 20; epoch++) {
      await f.store.putBudget(bound(epoch));
      const result = await Promise.all([f.store.reserve(request()), other.reserve(request())]);
      expect(result.map((r) => r.outcome).sort()).toEqual(["exceeded", "reserved"]);
    }
  } finally {
    await pool.end();
    await f.close();
  }
});
test("a crash after operation insertion rolls back every accounting projection", async () => {
  const f = await fixture();
  try {
    await f.store.putBudget(bound());
    const broken = await createPostgresStore({
      pool: f.client(),
      schema: f.schema,
      clock: f.clock,
      testHooks: {
        afterOperationWrite() {
          throw new Error("injected crash");
        },
      },
    });
    await expect(broken.reserve(request())).rejects.toThrow("injected crash");
    for (const table of [
      "metering_operation",
      "metering_budget_usage",
      "metering_event",
      "metering_command",
    ])
      expect(
        (await f.client().query(`SELECT count(*) AS n FROM "${f.schema}".${table}`)).rows[0].n,
      ).toBe("0");
    expect((await f.store.reserve(request())).outcome).toBe("reserved");
  } finally {
    await f.close();
  }
});
test("budget version compare-and-set has exactly one winner across pools", async () => {
  const f = await fixture(),
    pool = f.connect();
  try {
    const other = await createPostgresStore({ pool, schema: f.schema, clock: f.clock });
    const result = await Promise.all([f.store.putBudget(bound()), other.putBudget(bound())]);
    expect(result.map((r) => r.outcome).sort()).toEqual(["conflict", "saved"]);
  } finally {
    await pool.end();
    await f.close();
  }
});
test("a caller-owned transaction rolls host changes and accounting back together", async () => {
  const f = await fixture(),
    client = await f.client().connect();
  try {
    await f.client().query(`CREATE TABLE "${f.schema}".host_marker (id text PRIMARY KEY)`);
    await client.query("BEGIN");
    await client.query("SELECT set_config('search_path',$1,true)", [`"${f.schema}"`]);
    await client.query("INSERT INTO host_marker(id) VALUES('host-write')");
    const store = await createTransactionBoundStore({
      transaction: nodePostgresExecutor(client),
      clock: f.clock,
    });
    expect((await store.reserve(request("joined-command"))).outcome).toBe("reserved");
    await client.query("ROLLBACK");
    expect(
      (await f.client().query(`SELECT count(*) AS n FROM "${f.schema}".host_marker`)).rows[0].n,
    ).toBe("0");
    expect(
      await f.store.getOperation({
        namespace: "test",
        principal: "u1",
        operationId: "joined-command",
      }),
    ).toBeNull();
  } finally {
    client.release();
    await f.close();
  }
});
test("concurrent migrations are idempotent and reject an altered schema version", async () => {
  const f = await fixture(),
    pool = f.connect();
  try {
    await Promise.all([
      migratePostgresStore({ pool, schema: f.schema }),
      migratePostgresStore({ pool: f.client(), schema: f.schema }),
    ]);
    await pool.query(`UPDATE "${f.schema}".metering_schema_version SET checksum='tampered'`);
    await expect(migratePostgresStore({ pool, schema: f.schema })).rejects.toThrow(
      "Unsupported or modified",
    );
  } finally {
    await pool.end();
    await f.close();
  }
});
test("a failed database compare-and-set returns the typed dispatch refusal", async () => {
  const f = await fixture();
  try {
    const reserved = await f.store.reserve(request());
    if (reserved.outcome !== "reserved") throw new Error("fixture");
    await f
      .client()
      .query(
        `CREATE FUNCTION "${f.schema}".deny_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`,
      );
    await f
      .client()
      .query(
        `CREATE TRIGGER deny_update BEFORE UPDATE ON "${f.schema}".metering_operation FOR EACH ROW EXECUTE FUNCTION "${f.schema}".deny_update()`,
      );
    expect(
      await f.store.markDispatchIntent({
        ...command(reserved.operation),
        holder: "worker",
        leaseTtlMs: 1000,
      }),
    ).toMatchObject({
      granted: false,
      reason: "version_conflict",
      operation: { state: "reserved", version: 1 },
    });
  } finally {
    await f.close();
  }
});
