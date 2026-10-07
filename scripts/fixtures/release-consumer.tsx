import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { formatMoney, fromDecimalString } from "@usagekit/core";
import type { AccessContext, Meter } from "@usagekit/core";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { canonical as canonicalReference } from "@usagekit/store/reference";
import { createMeter } from "@usagekit/meter";
import { dataforseo, createCatalog } from "@usagekit/providers";
import { loadUsageSummary, parseProviderDecimal } from "@usagekit/views";
import { MeterProvider, useMeterBinding, createMeterQueryClient } from "@usagekit/react";
import {
  createPostgresStore,
  createPrismaPostgresDriver,
  migratePostgresStore,
} from "@usagekit/store-postgres";
import type { PostgresStoreOptions, PrismaPostgresClient } from "@usagekit/store-postgres";
import { Pool } from "pg";

const clock = createManualClock("2026-10-07T12:00:00.000Z");
const store = createMemoryStore({ clock, budgets: [] });
const meter: Meter = createMeter({ store, clock });
const access: AccessContext = {
  namespace: "consumer",
  readablePrincipals: ["owner"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: false,
};
const view = await loadUsageSummary(meter, access, {
  scope: { kind: "principal", namespace: "consumer", principal: "owner" },
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-11-01T00:00:00.000Z",
  units: ["requests"],
});
assert.equal(view.complete, true);
assert.equal(formatMoney(fromDecimalString("12.3456")), "12.3456");
assert.equal(typeof canonicalReference, "function");
assert.ok(createCatalog({ providers: [dataforseo], enabled: [dataforseo.descriptor.id] }));
assert.equal(parseProviderDecimal("0.012", "cents").outcome, "valid");
function Status() {
  const binding = useMeterBinding();
  assert.equal(binding?.meter, meter);
  return <span>Shared meter ready</span>;
}
const html = renderToString(
  <MeterProvider meter={meter} access={access} queryClient={createMeterQueryClient()}>
    <Status />
  </MeterProvider>,
);
assert.match(html, /Shared meter ready/);
// Import the durable adapter and check its public types without opening a database connection.
const pool = new Pool({ max: 1 });
const options: PostgresStoreOptions = { pool, clock, schema: "consumer" };
assert.equal(options.pool, pool);
assert.equal(typeof createPostgresStore, "function");
assert.equal(typeof migratePostgresStore, "function");
const driverFactory: (client: PrismaPostgresClient) => unknown = createPrismaPostgresDriver;
assert.equal(typeof driverFactory, "function");
await pool.end();
console.log("Consumer declarations, exports, headless reads and React server rendering passed.");
