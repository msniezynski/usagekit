# Cloudflare storage (P7)

`@usagekit/store-d1` is the private Cloudflare workspace named in the plan. Its implemented
backend is **authoritative SQLite-backed Durable Object storage**, exposed as
`createDurableObjectStore`. It does not accept a `D1Database`, replicate into D1, or claim that
an external D1 write is part of a Durable Object transaction. This selects the explicit
DO-ownership alternative in PLAN.md. Direct D1 support remains unimplemented.

## Authority and routing

Create the Store inside a SQLite-backed Durable Object with `ctx.storage` and a host clock.
Each Store command performs its reads, operation/receipt writes, admission projection,
idempotency journal, budget crossings and event history synchronously inside
`storage.transactionSync`. An exception rolls back that whole command. No external I/O or
callback lock is used to simulate rollback. A read command uses the same consistent SQL
snapshot. The DO owns all authoritative accounting data.

Route **all principals and connections in a namespace to the same Durable Object** using
`getByName(namespace)`. Shared group, tag and platform-pool budgets require this boundary;
sharding by principal would permit over-admission. Independent namespaces may use independent
objects. The Store itself is not an authorization boundary: the host supplies trusted access
context through Meter/HTTP and validates namespace ownership before dispatch.

The SQL layout follows the indexed SQLite adapter: operations and receipts are individual
rows, budget usage is an admission projection, expiration is indexed and bounded, and readers
use event watermarks with signed cursors. It never serializes the entire ledger per command.
All amount columns have TEXT affinity and become bigint at the SQL port. SQL INTEGER through
the Worker API cannot represent every supported amount exactly; versions and counts remain
checked safe integers. Cursor MACs use SHA-256/HMAC from `@noble/hashes`, without Node imports.

The private adapter ports the existing SQLite rules to web-standard code. Both adapters run
the unchanged Store conformance suite; changes to common accounting semantics must keep both
passing. There is no dependency on `better-sqlite3` or `nodejs_compat` in the Cloudflare bundle.

## Local example

The example is a fixed-namespace demonstration, not a product backend. It owns namespace
`demo`, principal `demo-user`, and a monthly limit of 10 requests. It mounts the existing
validated Meter HTTP contract with a bearer token. It does not call a paid provider.

From the repository root:

```sh
npm ci
npm run typecheck
cp examples/cloudflare-worker/.dev.vars.example examples/cloudflare-worker/.dev.vars
# Replace the example token in .dev.vars with a random local token.
npm run cloudflare:dev
```

The default local URL is `http://localhost:8787`. `.dev.vars` and `.wrangler` state are ignored.
Use the configured token in `Authorization: Bearer ...`. For example, with a local
`USAGEKIT_TOKEN` environment variable:

```sh
curl http://localhost:8787/v1/operations/reserve \
  -H "Authorization: Bearer $USAGEKIT_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"commandId":"reserve-demo","operationId":"demo-1","scope":{"namespace":"demo","principal":"demo-user","connection":"example"},"fundingSource":"byok","costOwner":"demo-user","surface":"app","source":"app","provider":"example","operation":"search","estimate":[{"unit":"requests","value":"1","scale":0}]}'
```

Only the first successful dispatch grant authorizes a provider call. A reservation is not a
billable receipt. Continue through `/v1/operations/intent` and `/v1/operations/settle` using the
returned operation version and lease; the runnable smoke script demonstrates the sequence.
The default five-minute reservation expiry restores unused headroom on later admission.
Intended or uncertain dispatches require recovery evidence and are never silently released.

`npm run cloudflare:types` regenerates the ignored Worker environment/runtime declarations
from Wrangler configuration, including the required secret. `npm run typecheck` also does this.
The adapter itself uses only a small structural SQL-storage port and web types.

## Verification

```sh
npx vitest run --project store-d1
npm run test:cloudflare:example
npx wrangler deploy --dry-run --config examples/cloudflare-worker/wrangler.jsonc
npm run check
```

Conformance uses real Miniflare/workerd SQLite storage, advertises `durable: true`, and disposes
and recreates the runtime against the same persistence directory for restart tests.
`rollingWindows` remains unsupported, as in the SQLite adapter, and is explicitly skipped.
Miniflare 5 requires `resourcePersistencePath`; the older `durableObjectsPersist` option is
not used. The pinned Miniflare version follows the pinned Wrangler dependency.

Additional checks cover:

- Two independent Worker entrypoints racing through one object on a shared pool, followed by
  competing dispatch intents: one admission and one dispatch grant.
- Injected failure during settlement: operation, receipt, event, command and projection roll
  back, and the identical command succeeds on retry.
- Immutable budget versions and concurrent version updates, plus cursor integrity after restart.
- 5000 existing operations without an increase in command statements, changed or returned rows;
  reads and cursor pages remain read-only.
- The actual `wrangler dev --local` entrypoint: authentication, namespace/principal isolation,
  reserve/replay/denial, dispatch, exact settlement above 2^53, full process restart and durable
  settlement replay/admission projection.

## Lifecycle and boundaries

Wrangler's `v1` migration creates the SQLite-backed `UsageLedger` class. The adapter initializes
schema version 1 transactionally on object activation and rejects unknown versions. Initial
budget definitions may be supplied again unchanged; an existing version cannot be overwritten.
Later definitions require `putBudget` with the next version. Operation epochs retain the budget
version used at reservation.

Local dev, automated smoke and Miniflare tests own separate persistence directories. The smoke
stops only its own child process and deletes only its own temporary state. A normal dev restart
preserves local state. Remote deploy, rollback or secret rotation must retain the class name,
namespace routing and stored budget definitions. The ordinary example configures no scheduled cleanup, production deployment or additional npm
publication. Optional isolated remote tests are documented in [CLOUDFLARE-REMOTE.md](CLOUDFLARE-REMOTE.md). Before changing the
storage schema, add a forward migration and test old-state recovery; rolling back code across
an incompatible schema is unsupported.

The DO is one serial accounting authority per namespace, so a namespace's throughput and
storage capacity are bounded by that object. Events, receipt history and replay journals grow
until an explicit retention policy is designed. Retention and production authority cutover
remain P8 work. The example token grants access only to the fixed demo principal and provides
no user management, provider credential vault, provider routing or cross-object transaction.

## Cloud validation

The adapter also passed [remote integration tests on Cloudflare](validation/2026-09-27-p7-cloudflare.md), including two deployed gateways, shared-budget races, transaction rollback and data recovery after redeployment. The report includes transport failures and measurement limits.
