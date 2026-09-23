# usagekit implementation plan

Date: 2026-09-23. Owner: Michal. Status: proposal with type-only bootstrap contracts.

## 1. Purpose and deployment modes

The owner agreed to own metering with admin composition and existing host ledgers as credit authorities.
Optional downstream export remains part of that direction.
The admin must show usage, provider costs and application credit information.
Implementation details remain proposals. No release, publication or deployment is approved.

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
Core exports `Meter`; embedded Meter and the future HTTP client implement it.
Only types exist today. Runtime validation and implementations belong to P1 and P2.
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
  if (!grant.granted) return recoverExisting(grant.operation);
  // Host helper renews during long calls and stops on rejected renewal.
  const receipt: Receipt = await callProviderAndCaptureOutcome(context, async () => {
    const renewal = await meter.renewLease({
      ...ref,
      leaseId: grant.lease.leaseId,
      leaseTtlMs: context.leaseTtlMs,
    });
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
- Store commands are atomic: `reserve`, `markDispatchIntent`, `renewLease`, `claimForRecovery`, `settle`, `releaseUndispatched` and `correct`.
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
- Settlement requires active caller-held dispatch or recovery authority. Late evidence requires `pending` or `settled` state and no active lease.
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
  Connection/access-credential reads require a readable owning principal or group. Store resolves ownership; Meter checks it.
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

Only three workspace directories exist. Add future packages when their first real implementation exists.
Host schema mappings live in host repositories. Shared Prisma code provides mechanics only.

| Package        | Exists | Runtime | Responsibility                                                 |
| -------------- | ------ | ------- | -------------------------------------------------------------- |
| `core`         | yes    | web     | Exact DTOs and the single Meter interface                      |
| `store`        | yes    | web     | Atomic port; reference store and conformance planned           |
| `meter`        | yes    | web     | Core interface re-export; embedded implementation planned      |
| `providers`    | no     | web     | Descriptors, price versions, receipt fixtures and probes       |
| `store-prisma` | no     | node    | Optional shared Prisma mechanics, without host schema mappings |
| `store-sqlite` | no     | node    | Local server storage                                           |
| `store-d1`     | no     | web     | Cloudflare storage and atomicity proof                         |
| `http`         | no     | web     | Authenticated write/read handlers and wire validation          |
| `client`       | no     | web     | Remote implementation of the core Meter interface              |
| `react`        | no     | web     | Headless usage, balance and budget views                       |
| `proxy`        | no     | node    | Local provider routes, key injection and admission             |
| `wallet`       | no     | web     | Optional ledger primitives after host stabilization            |
| `server`       | no     | node    | Local API, SQLite, vault and recovery scheduler                |
| `cli`          | no     | node    | Local server commands and usage reads                          |

Web projects extend `tsconfig.base.json`. Node projects extend `tsconfig.node.json`.
A D1 entry point must not import Node modules or a Node SQLite entry point.
The workspace inventory rejects undeclared directories and dependency cycles.
Optional exporters start in host/server composition. No separate analytics package is planned.

## 5. Delivery stages

Each stage keeps an exit gate. This order serves embedded metering, the local server, then proxy traffic.

| Stage | Deliverable                                                                      | Serves          | Exit gate                                                                                                                                                                                                                                                                                         |
| ----- | -------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1    | Core types, atomic store port, in-memory store, conformance and embedded Meter   | all             | Precision, concurrency, replay and unknown outcomes pass. Crash recovery rules pass against the in-memory store under simulated process loss. Lost holders cannot regain dispatch; replay returns stored results. Recovery claims only lease-free operations; late evidence settles pending work. |
| P2    | store-sqlite, HTTP write/read, client, local server without proxy, CLI usage     | local server    | Embedded/remote parity, keys, authenticated admission and denied budgets pass. SQLite restart recovery: reserve and mark intent, terminate, restart on the same file. `getOperation` shows `dispatch_intended` with an expired lease. Recovery claim succeeds; new dispatch intent is refused.    |
| P3    | Host A adapter in its repository, shadow mode and first admin over Meter queries | embedded, admin | Matching usage totals, host balances, scoped reads and no billing side effects                                                                                                                                                                                                                    |
| P4    | Local proxy routes, key injection, receipt extraction and blocking               | proxy           | Allowlisted routes, real denied dispatch, correct errors and restart recovery                                                                                                                                                                                                                     |
| P5    | store-d1 and host C backend with privacy/reward gates                            | embedded        | Shared-bound races, cache/pagination, reward deduplication and approved retention                                                                                                                                                                                                                 |
| P6    | Authoritative host A cutover with credit coordination                            | embedded        | Single authority, real database crash tests, reconciled holds and rehearsed rollback                                                                                                                                                                                                              |
| P7    | Headless React and local reference UI                                            | admin           | Usage/cost/credit views, freshness, permission checks and accessible host composition                                                                                                                                                                                                             |

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

| Decision                                | Proposed default                                               | Gate                      |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------- |
| Runtime validation and rounding         | Exact units, explicit adapter ranges, reject invalid scales    | P1                        |
| Unknown exposure and overrun            | Conservative reservations; recorded correction or debt         | P1, host policy before P6 |
| Local key custody                       | Encrypted vault, authenticated loopback API, explicit unlock   | P2                        |
| Admin permission and retention          | Host scopes, content-free evidence, finite replay horizon      | P3                        |
| D1 authority and joint budgets          | Prove atomic commands or DO ownership                          | P5                        |
| OpenSearch Incognito                    | Disclosed minimal accounting proposed, not yet approved        | P5                        |
| Credit coordination                     | Shared transaction where possible; durable host saga otherwise | P6                        |
| Public license, organization and domain | Undecided; local and private                                   | Separate owner decision   |

No remote, push or publication is authorized. Squash integration follows the README.
Type-only bootstrap completion does not imply working metering or adapter conformance.

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
