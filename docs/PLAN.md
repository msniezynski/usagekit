# usagekit implementation plan

Date: 2026-09-24. Owner: Michal. Status: P1 and P2 approved on main; P3 in progress.

## 1. Purpose and deployment modes

The owner agreed to own metering with admin composition and existing host ledgers as credit authorities.
Optional downstream export remains part of that direction.
The admin must show usage, provider costs and application credit information.
P3 authorizes restricted npm publication of core, store and meter at 0.1.0. Deployment remains outside this work.

| Mode         | Execution                                                | Boundary                                                                |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Embedded     | A trusted host wraps provider dispatch with Meter        | Only instrumented host paths are enforced                               |
| Local server | SQLite, local keys, authenticated write/read API and CLI | Reporting clients must honor admission; proxy enforcement follows in P4 |

Host A uses Postgres and Prisma. Host B uses Postgres, Prisma and team-owned connections.
Host C targets Cloudflare D1. Private consumer evidence stays in ignored ADRs.
Hosts own authentication, routing, secrets, content and product billing.
The local server owns its vault, admission and later proxy dispatch.
The [README](../README.md) defines workflow rules. The [local ADR index](adr/0000-index.md) holds private rationale.

## 2. One interface and end-to-end flow

Meter validates inputs, resolves host policy (applicable budgets, funding, price version) and maps store outcomes to typed results and errors.
Store executes each command atomically and re-checks every condition that depends on concurrent state:
operation state, version, lease ownership, budget headroom including outstanding reservations, and command replay identity.
A check done in Meter is never sufficient on its own.
Store returns a typed outcome for every rejection; it does not throw for expected outcomes.

One interface, two implementations, one contract test suite that runs against both.
Core exports `Meter`; embedded Meter and the HTTP client implement it.
P1 and P2 validate runtime inputs; the same conformance suite exercises both implementations.
Bigints cross HTTP as decimal strings. The client restores bigint DTOs; timestamps remain UTC ISO strings.
See [core contracts](../packages/core/src/contracts.ts) for all quantities, lifecycle, receipt and command DTOs.
`AllowanceExceeded` is data, not an Error subclass. `Cost` excludes contradictory money/certainty combinations.

```ts
import type { AccessContext, DispatchGrant, Meter, Receipt, ReserveResult } from "@usagekit/core";

async function execute(meter: Meter) {
  const context = await authenticateAndAuthorize();
  const access: AccessContext = context.access; // Verified server context, never client input.
  const reserved: ReserveResult = await meter.reserve(context.reserveInput);
  if (reserved.outcome !== "reserved") return reserved;
  if (reserved.replayed) return reserved; // Stored result; never dispatch a replay.
  const operation = reserved.operation;
  const ref = {
    namespace: operation.scope.namespace,
    principal: operation.scope.principal,
    operationId: operation.operationId,
  };
  await confirmRequiredHostCreditHolds(operation);
  const grant: DispatchGrant = await meter.markDispatchIntent({
    ...ref,
    commandId: context.dispatchCommandId,
    expectedVersion: operation.version,
    holder: context.holder,
    leaseTtlMs: context.leaseTtlMs,
  });
  if ("outcome" in grant) return grant;
  if (!grant.granted) return recoverExisting(grant.operation);
  // Host helper renews during long calls and stops on rejected renewal.
  const receipt: Receipt = await callProviderAndCaptureOutcome(context, async () => {
    const renewal = await meter.renewLease({
      ...ref,
      leaseId: grant.lease.leaseId,
      leaseTtlMs: context.leaseTtlMs,
    });
    if ("outcome" in renewal) throw handOverToRecovery(grant.operation);
    if (!renewal.renewed) throw handOverToRecovery(grant.operation);
    return renewal.lease;
  });
  const settled = await meter.settle({
    ...ref,
    commandId: context.settleCommandId,
    expectedVersion: grant.operation.version,
    authority: { kind: "lease", leaseId: grant.lease.leaseId },
    receipt,
  });
  if (settled.outcome === "invalid") return settled;
  if (settled.outcome !== "settled") return recoverExisting(settled.operation);
  await settleHostCreditsIdempotently(settled.operation);
  return meter.usage(access, {
    scope: { kind: "principal", namespace: ref.namespace, principal: ref.principal },
    from: context.from,
    to: context.to,
    units: context.units,
    groupBy: ["provider", "day"],
    limit: 100,
  });
}
```

The host helper captures charged errors and unknown outcomes. Lost-lease handover stops execution and schedules evidence recovery.
Recovery never redispatches. A failed accounting write retries its original command and receipt, not the provider call.
Admin composes `meter.usage` with authorized host balances. Read methods return `{ outcome: "forbidden" }` for unauthorized scope.

## 3. Contract constraints

- Connections belong to groups in some hosts. Principal is then a trusted host projection.
  Snapshot owner, actor, credentials and funding at admission. Transfers do not rewrite history.
  `accessCredential` identifies the caller by kind/id and survives provider rotation.
  `providerCredentialVersion` identifies the provider secret version, never the caller.
- Calendar month is one window kind. Provider cycles, rolling windows and since-reset epochs also exist.
  Keep original epochs for in-flight work; test moving rolling-window boundaries before advertising support.
- The paid wrapper is not the only interception point. Inventory workers, queues, polls, retries, pagination and connection tests.
  Cache reads do not create provider usage. HTTP success does not prove business success or billing.
- Store commands are atomic: `reserve`, `markDispatchIntent`, `renewLease`, `claimForRecovery`, `settle`, `releaseUndispatched`, `expireReservations` and `correct`.
  Store reads are `getOperation`, `aggregate`, `definedBudgets` and `applicableBudgets`. Every adapter proves mutation atomicity independently.
  Admission includes settled use and outstanding reservations across applicable owner, platform, connection and credential bounds.
  Connection locks alone cannot enforce a shared principal or platform limit.
- `BudgetScope` names one principal, group, connection, access credential or shared platform pool constraint.
  Pools apply across principals named by operations' `platformPools`; they are not the platform principal's budget.
  Store atomically selects current budgets matching namespace, bound and surface (`any` or the operation surface).
  Match principal/group/connection IDs, access credential kind/id, or a pool listed in `platformPools`.
  Estimate every bounded unit. Missing units are Meter validation errors; Store re-checks against current budgets to prevent bypass.
  Units without budgets are recorded unbounded. Snapshot current budget versions and resolved epochs into `budgetEpochs`. Check all bounds atomically; report the first exceeded in deterministic host-policy order.
  Default order: `platform_pool`, `principal`, `group`, `connection`, `access_credential`. Budgets constrain use; host ledgers own balances, holds and charges through the credit bridge. A principal monthly cap is still a constraint.
- Undispatched reservations expire after five minutes by default; hosts may supply `reservationTtlMs` from 1 ms to one day.
  `reservationExpiresAt` is immutable. Replay never extends it; dispatch at or after expiry atomically releases the reservation and returns `reservation_expired` without granting authority.
  `expireReservations` atomically releases only expired `reserved` operations, preserving version checks and returning budget headroom.
  Reserve performs one default cleanup batch before admission. Server startup and thirty-second sweeps handle idle clients; reads never mutate.
  Dispatch intent permanently excludes automatic release. Its lease expiry still requires provider evidence recovery.
- Unknown is not zero. Timeouts and expired leases do not prove no charge.
  Release only undispatched work with version checks. Record late charges and overruns through explicit correction policies.
- Certainty is independent from lifecycle: `measured | estimated | unknown` versus `reserved | dispatch_intended | pending | settled | released`.
  Keep certainty per measurement and cost, never per receipt. Receipt history is append-only, oldest first.
  Corrections name `supersedes`; the effective receipt is the latest not superseded one. Retain evidence and recording times.
- Operation identity is not correlation identity. A paid retry gets a new operation; an accounting replay keeps its command ID.
  Reject changed payloads under reused IDs. Do not deduplicate intentional identical requests using body hashes.
  Scope provider request IDs correctly. Check command replay before optimistic version conflicts, except dispatch replay never regrants authority.
  Reserve replay returns its operation in any state. Changed semantic fields return conflict; budget denial returns exceeded data.
- Only the first dispatch intent grants the upstream call and an active lease for settlement.
  Same-command replay or another command after intent returns `already_dispatched`. Neither replay nor expiry permits another call.
  Only the active holder may renew for long calls. Rejected renewal stops work and hands over to recovery.
  Expiry does not change state. Recovery claims only `dispatch_intended` or `pending` operations without active leases.
  Each claim issues a new leaseId and fences the old holder. Recovery never redispatches.
  Resolve provider or supported idempotency evidence, then settle, correct, or leave `pending` uncertain exposure.
- Settlement requires active caller-held dispatch or recovery authority. Late-evidence settlement requires `pending` state and no active lease.
  After settlement, new evidence requires `correct`, a replaced receipt and a reason. All new commands check the operation version.
  Late evidence needs host authorization, not a lease; Store records its source.
  Corrections follow those authority rules and target existing receipts. Append revisions; never delete evidence.
  Identical command replay returns the stored result with `replayed: true`; a changed receipt returns `receipt_conflict`.
  Undispatched release requires host authorization, `reserved` state and atomic version validation, without a lease.
  After dispatch intent, release rejects with `not_reserved`.
- Use bigint money in 1/10000 cent. Quantity represents `value * 10^-scale` in a named unit.
  Adapters must validate Decimal(10,4), Decimal(18,6) and Decimal(12,4) compatibility where applicable.
  Never pool unrelated native units. Estimates cannot guarantee spend ceilings without enforceable request or output bounds.
- BYOK and platform funding are separate. Upstream cost owner, initiating actor and customer credit account can differ.
  Show provider cost separately from customer charges. Never treat consumed credits as recognized revenue without host policy.
- Accounting is content-free; each credit balance has one authority: initially its host ledger.
  Store no prompts, queries, result bodies, secrets or content fingerprints by default.
  Admin permissions separate own usage, team usage, global aggregates, billing details, budget edits and credit adjustments.
  Forged principals, receipts, foreign operation IDs and cursors must fail authorization.
- Query scope is not authorization. The host builds `AccessContext` from a verified session or token.
  Meter reads take that context first. Wider requests return `forbidden`; never silently widen or narrow queries.
  HTTP derives access from authentication, never request bodies or query strings. Store does not accept AccessContext.
  `groupBy: "principal"` requires group or namespace scope; grouping also supports `access_credential` and `platform_pool`.
  Within the verified namespace, principal/group reads require their readable list or `*`.
  Connection/access-credential reads require a readable owning principal or group. A host callback resolves ownership; Meter checks it.
  Direct pool reads require `readablePools`, `*`, or `canManageBudgets`; this also applies to pool usage.
  `definedBudgets` lists definitions for exactly one `BudgetScope`, without an operation or required connection.
  `applicableBudgets` requires a readable operation principal and lists matching bounds for its scope, surface, units and pools.
  Unreadable pool statuses have `budget.limit`, `used`, `reserved` and `remaining` set to `null`, with `redacted: true`.

D1 must prove guarded atomic commands or authoritative Durable Object storage. A lock around separate external writes does not provide rollback.
See [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) and [DO transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactions).
Capabilities declare supported bounds, precision and consistency. Unsupported guarantees fail configuration.

### Scope examples

Examples use the exported `ReserveInput` type and any-surface user budgets; both bounded units are estimated.

<!-- prettier-ignore -->
```ts
const ownKey = {
  operationId: "op_1", provider: "serpapi", operation: "search", source: "app", surface: "app",
  scope: { namespace: "demo", principal: "u_1", connection: "c_serpapi_u1", providerCredentialVersion: "v3" },
  fundingSource: "byok", costOwner: "u_1",
  estimate: [{ value: 1n, scale: 0, unit: "units" }, { value: 1n, scale: 0, unit: "requests" }],
} satisfies ReserveInput;
```

Applies: the connection's provider-cycle budget in `units` and the user's principal budget for paid `requests`.

```ts
const mcp = {
  ...ownKey,
  operationId: "op_mcp",
  source: "mcp",
  surface: "programmatic",
  scope: { ...ownKey.scope, accessCredential: { kind: "oauth_client", id: "mcp_42" } },
} satisfies ReserveInput;
```

Applies: both previous budgets plus the access-credential cap of 200 requests per calendar month; token and user limits hold together.

<!-- prettier-ignore -->
```ts
const shared = [
  { ...ownKey, operationId: "op_pool_u1", scope: { namespace: "demo", principal: "u_1", connection: "c_platform_search" },
    fundingSource: "platform", costOwner: "platform", platformPools: ["pool_search_free"] },
  { ...ownKey, operationId: "op_pool_u2", scope: { namespace: "demo", principal: "u_2", connection: "c_platform_search" },
    fundingSource: "platform", costOwner: "platform", platformPools: ["pool_search_free"] },
] satisfies readonly ReserveInput[];
```

Applies to each: its user's principal cap of three free searches and the shared pool's monthly cap of 10000 units, counting both users.
For guests, use `principal: "guest"` and `actor: "sess_…"`; the host enforces per-actor limits alongside the guest principal and pool budgets.
A guest session is not a budget owner; the platform's principal or a dedicated guest principal owns the operation.
The pool constrains shared spend; provider balances and customer credit balances remain in their ledgers.

## 4. Package grid

Eight workspace directories exist. Add future packages when their first real implementation exists.
Host schema mappings live in host repositories. Shared Prisma code provides mechanics only.

| Package        | Exists | Runtime | Responsibility                                                 |
| -------------- | ------ | ------- | -------------------------------------------------------------- |
| `core`         | yes    | web     | Exact DTOs and the single Meter interface                      |
| `store`        | yes    | web     | Atomic port, reference rules and factory-based conformance     |
| `meter`        | yes    | web     | Embedded validation, host policy and authorized reads          |
| `providers`    | no     | web     | Descriptors, price versions, receipt fixtures and probes       |
| `store-prisma` | no     | node    | Optional shared Prisma mechanics, without host schema mappings |
| `store-sqlite` | yes    | node    | Local server storage                                           |
| `store-d1`     | no     | web     | Cloudflare storage and atomicity proof                         |
| `http`         | yes    | web     | Authenticated write/read handlers and wire validation          |
| `client`       | yes    | web     | Remote implementation of the core Meter interface              |
| `react`        | no     | web     | Headless usage, balance and budget views                       |
| `proxy`        | no     | node    | Local provider routes, key injection and admission             |
| `wallet`       | no     | web     | Optional ledger primitives after host stabilization            |
| `server`       | yes    | node    | Local API, SQLite, vault and explicit recovery commands        |
| `cli`          | yes    | node    | Local server commands and usage reads                          |

Web projects extend `tsconfig.base.json`. Node projects extend `tsconfig.node.json`.
A D1 entry point must not import Node modules or a Node SQLite entry point.
The workspace inventory rejects undeclared directories and dependency cycles.
Optional exporters start in host/server composition. No separate analytics package is planned.

## 5. Delivery stages

Each stage keeps an exit gate. This order serves embedded metering, the local server, then proxy traffic.

| Stage | Deliverable                                                                      | Serves          | Exit gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | Core types, atomic store port, in-memory store, conformance and embedded Meter   | all             | Passed: precision, atomic admission, replay, leases, pending exposure, corrections, access, snapshot reads and generated interleavings. Simulated process loss fences old holders and never regrants dispatch. Skipped guarantees: `durable`, `rollingWindows`.                                                                                                                                                                                                                                                                                                                                                                 |
| P2    | store-sqlite, HTTP write/read, client, local server without proxy, CLI usage     | local server    | Passed: unchanged conformance through SQLite and remote Meter, authenticated CLI admission, encrypted keys and token rotation. SIGKILL/reopen preserves intent and expired lease; recovery succeeds and redispatch fails. Two-process admission: 20/20 races, one winner each. HTTP restart and transaction rollback pass. SIGKILL before intent recovers headroom after reservation expiry. At 5000 records, command statements, returned rows and changed rows stay constant. Read-only reads and concurrent budget version writes pass. SQLite skips only `rollingWindows`; remote-memory skips `durable`, `rollingWindows`. |
| P3    | Host A adapter in its repository, shadow mode and first admin over Meter queries | embedded, admin | Matching usage totals, host balances, scoped reads and no billing side effects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P4    | Local proxy routes, key injection, receipt extraction and blocking               | proxy           | Allowlisted routes, real denied dispatch, correct errors and restart recovery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P5    | store-d1 and host C backend with privacy/reward gates                            | embedded        | Shared-bound races, cache/pagination, reward deduplication and approved retention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P6    | Authoritative host A cutover with credit coordination                            | embedded        | Single authority, real database crash tests, reconciled holds and rehearsed rollback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P7    | Headless React and local reference UI                                            | admin           | Usage/cost/credit views, freshness, permission checks and accessible host composition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

The store conformance suite is parameterized by a store factory.
Durability tests require a persistent store. The in-memory store skips them and reports the skip.
A skipped test is not a passed guarantee.

P2 admission blocks cooperating clients. It cannot prevent calls made outside the server contract.
P4 blocks routed provider dispatch. Neither mode controls traffic bypassing it.
Bind the local server to loopback. Require authentication and a locked encrypted vault with explicit unlock behavior.
Validate origins and key permissions. Keep provider credentials out of API responses, receipts and logs.
P3 admin includes balances, held/debt/expiry where available, usage, costs, operation details and exception queues.
Missing data shows unavailable. Projections expose freshness; current balances read the host authority.
Bound query windows, groupings and pagination. Preserve exact amounts and display certainty.
Shadow mode does not reserve credits or alter production admission.
Cut over by operation/epoch ownership. Drain old work under its old authority without double reservation or charging.
Rollback reconciles counters first. Recovery continues for new-system holds and late receipts until drained.

## 6. Open decisions

P3 packaging ships compiled conformance cases without test runner files or source maps.
Vitest 5 and fast-check 4 are optional peers: adapter-test consumers install them; runtime consumers do not need them.
Release dry-run proves build, checks and tarball contents on a clean branch. Live release additionally requires main, signed tag and npm authorization.
P3 uses Apache-2.0 and registry.npmjs.org under the usagekit organization. Private packages become public only after the complete P3 exit gate.
No host code has been copied into these packages. Host integration must audit authors before moving any source into this repository.

SQLite executes targeted SQL commands inside `BEGIN IMMEDIATE`, with version/state predicates and incremental `budget_usage` changes.
Reads use DEFERRED transactions without writes. Signed cursor pages use an immutable accounting-event watermark and expire after five minutes.
The scaling gate compares reserve, intent and settle before and after 5000 records: 25 prepares, 8 returned rows, 12 changed rows.
Aggregation work follows matching history. Reservation cleanup follows expired backlog; neither claims constant work for arbitrary backlog or query size.
Migration removes redundant full snapshots and backfills events and reservation deadlines. Legacy pre-event cursors must restart their query.
Operation identity stays namespace-wide, matching P1, with an additional unique index over namespace and operation ID.
Quantities and budget totals store INTEGER values with explicit scales. Cursor snapshots expire after five minutes.
Wire command IDs identify requests. Reserve deduplicates by operation ID; renewal and recovery retain P1 semantics without a command journal.
P2 uses the existing P1 task branch by owner instruction, without promoting main.
Client has a type-only HTTP dependency for inferred wire DTOs; checks reject runtime imports of that package.
CLI has an explicit server dependency to implement `serve`; other commands remain HTTP clients.
Encrypted vault tests require no plaintext marker in any file, including the encrypted vault.
CLI reserve obtains dispatch intent before allowing a provider call. Replayed reservations never authorize dispatch.
CLI settlement and release persist exact request bodies for retries, including receipt times and expected versions.
The local token owns the namespace. Before multi-user writes, P6 requires independent write permissions, not read permission reused as authorization.
P6 must also prevent cross-principal operation-ID collisions and existence disclosure before exposing namespace-wide identity to untrusted callers.
P2 decisions: `reservationTtlMs`, `reservationExpiresAt`, `reservation_expired` and namespace-scoped `expireReservations` extend the shared contract.
Expiry sweeps return `count` and `hasMore`; repeated sweeps are safe, but counts are not command-journal replay results.
HTTP expiry requires `canManageBudgets`. Embedded hosts authorize maintenance and coordinate any external credit holds themselves.
The local server releases overdue undispatched reservations at startup and every thirty seconds. A budget read can retain exposure until cleanup.
No provider catalog or provider-evidence recovery worker exists in P2. Provider tests validate format without network calls.
Interactive vault creation confirms the passphrase; automated environment input is supplied once by its operator.
Startup errors expose safe categories. Provider identity changes under an existing connection ID are rejected.
Wire integer decoding recognizes accounting DTO shapes; unrelated metadata strings remain strings.
See [local server operation](LOCAL-SERVER.md) for startup, custody, reporting and recovery limits.

P1 review: default budget ordering has one frozen source in core.
Renewal has no command journal; a later retry can extend expiry without changing operation version.
SQLite expires cursor snapshots after five minutes. The memory reference currently retains snapshots indefinitely.
P2 wire schemas validate fields explicitly. Empty optional `Receipt.evidenceRef` is accepted by Meter and HTTP.

Version invariants distinguish renewal from accounting mutations. Renewal preserves version; an expired intent denial also performs a versioned release.
Dispatch replay always refuses another grant. Settlement, correction and release replay return stored outcomes.
Admission never oversubscribes a blocking limit. A later measured overrun is recorded and blocks further admission.
Warn-only bounds never override another blocking bound. Corrections and recovery may preserve the lifecycle state.
Lease IDs are capabilities inside the trusted embedded boundary. Hosts authenticate workers before exposing write methods.
`canReadBillingDetail: false` forbids detailed usage and operation reads. Budget access follows the explicit scope rules.
The test-only conformance entry point is typechecked separately and excluded from production declaration emission.

P1 decisions: dispatch, settlement and release rejections permit null operations for unknown IDs.

P1 decisions: `ValidationFailure` is shared by command and read results.
`createMeter({ resolveOwnership })` accepts an optional trusted host callback for connection or token ownership.
Without it, resource-scoped reads are forbidden. Store has no host ownership port.
`AdmissionPolicy` passes host budget order into atomic reserve.
`BudgetOwner` names the principal or group returned by the host ownership callback.

P1 decisions: reserve rejects missing bounded estimate units with `missing_estimate_unit`.
Successful reservations carry `warnings` for warn-only bounds.

| Decision                                | Proposed default                                               | Gate                        |
| --------------------------------------- | -------------------------------------------------------------- | --------------------------- |
| Runtime validation and rounding         | Exact units, explicit adapter ranges, reject invalid scales    | P1                          |
| Unknown exposure and overrun            | Conservative reservations; recorded correction or debt         | P1, host policy before P6   |
| Local key custody                       | Encrypted vault, authenticated loopback API, explicit unlock   | P2                          |
| Admin permission and retention          | Host scopes, content-free evidence, finite replay horizon      | P3                          |
| D1 authority and joint budgets          | Prove atomic commands or DO ownership                          | P5                          |
| OpenSearch Incognito                    | Disclosed minimal accounting proposed, not yet approved        | P5                          |
| Credit coordination                     | Shared transaction where possible; durable host saga otherwise | P6                          |
| Public license, organization and domain | Apache-2.0, npm organization usagekit; domain undecided        | Public access after P3 exit |

Restricted npm publication is authorized through the release allow-list. GitHub repository target remains unspecified. Squash integration follows the README.
P1 proves reference-store rules and embedded Meter behavior. It does not prove persistent adapter durability.

## 7. Appendix: Later, optional

**Host B adapter.** Keep mappings inside its repository. Prove team ownership, original reset epochs and unchanged product billing.
Each new consumer inventories all paid paths. Historical aggregates remain aggregates when receipts are unavailable.

**AI receipts and streaming.** Record requested/resolved model, disclosed provider, gateway, feature and parent operation.
Cached input and reasoning tokens can overlap other categories. Descriptor rules prevent double counting.
A gateway receipt and upstream receipt may describe one charge. Choose one billing source and preserve secondary evidence.
Record provider tariff and customer-price versions independently. Price-derived costs remain estimates until billing evidence supports them.
Do not infer discounts, tiering or gateway fees. Each paid retry, fallback or tool call has its own child operation.
Use bounded incremental parsing and backpressure. Cancellation or missing final usage does not prove zero cost.
Persist dispatch intent and recovery references. Never rely on an unawaited promise or unbounded stream tee for settlement.
Verify provider-specific fixtures for billed failures, missing receipts, queued tasks, partial/cumulative receipts and price changes.
Only advertise proven operations. Sandbox calls require explicit spend limits; deterministic tests stay offline.
Balance probes carry pool identity, meaning, timestamps and freshness. Top-ups, external usage and delayed reports can cause drift.
Snapshot subtraction cannot prove per-call cost. Prefer request/task evidence and preserve unexplained adjustments separately.

**Outbox and export.** When enabled, commit source changes and versioned events atomically.
Events carry opaque IDs, exact units, certainty, funding, revisions and occurrence/recording timestamps.
Deliver at least once with durable deduplication, ordering checks, backoff, dead letters and explicit replay.
Corrections cannot apply twice. Rebuild projections from retained events/snapshots without replaying historical exports as new charges.
Define destination subject mapping, units, privacy and correction semantics before enabling each metric.
Unsupported negative corrections require separate reconciliation. Export failure never redispatches providers or changes authoritative balances.
Bound backlog storage and expose watermarks. Diagnostic traces can be sampled; financial accounting cannot.
OpenMeter supports [entitlements](https://openmeter.io/docs/billing/entitlements/entitlement) and [grants](https://openmeter.io/docs/billing/entitlements/grant).
It remains optional because host ledgers retain authority. Moving that authority requires a separate reconciled migration.

**Wallet extraction.** Wait for stable host execution. Preserve lot priority, grants, expiry, holds, debt, refunds and immutable corrections.
Product refunds do not imply provider refunds. Rewards require host eligibility and family-level deduplication.
P6 still needs credit coordination, even without a shared wallet package.
With separate stores, persist a host coordinator before holds. Dispatch only after every required reservation is confirmed.
Query unknown hold outcomes by command key. Compensate confirmed holds only before dispatch with version/fencing checks.
After dispatch, failed ledger writes remain pending recovery. They cannot erase spend or authorize another call.
Test crashes around every hold, receipt, debit and acknowledgment. Lease expiry alone never releases uncertain exposure.

**Hosted service and retained constraints.** Multi-user hosting requires separate authorization, tenancy, custody, abuse and operational design.
Never link people across applications by email automatically. Scope account federation and cross-app admin access explicitly.
Choose retention for evidence, replay keys, aggregates, audits, diagnostics, exports and backups before launch.
Reject expired replays. Deletion must preserve required financial evidence through unlinking or permitted pseudonymization.
Private accounting never grants content access. Literal zero persistence conflicts with durable Incognito recovery.
OpenSearch rewards require eligible own-key Shared results. Private, Incognito and platform-funded guests remain ineligible under the reviewed prototype.
Set workload, latency, freshness and recovery targets before enforcement. Monitor unknown exposure, debt, rejection, drift and settlement/export lag.
Rehearse backup restoration, projection rebuild and rollback. Never recover by clearing all holds or resending all provider calls.
