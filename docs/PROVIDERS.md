# Provider descriptor design (P5)

Status: P5 shipped in the 0.4.0 release and the P8 billing parser in 0.5.0; both are part of the published `@usagekit/providers` package. This file is the specification of the provider catalog and is kept in
sync with the types in `packages/core/src/providers.ts` and the `@usagekit/providers` package.

## 1. What a descriptor is

A descriptor is data plus a small amount of pure code that tells usagekit everything it needs
to price, route, meter and reconcile one provider. It lives in `@usagekit/providers`, one
directory per provider, and is loaded by hosts, the local server and the proxy through one
`Catalog` object. The core contract does not depend on descriptors; descriptors depend on core.

Facts the design rests on, verified on the first two providers:

- One provider reports cost per call in every response (`cost` at top level and per task) and
  exposes its price list and account identity through an API; its balance is prepaid money.
- The other provider reports no cost per call, only a search id; its account endpoint exposes
  the plan, the searches left, the renewal date and the account e-mail; its allowance is a
  monthly plan with purchasable extra credits.
- Both authenticate differently (basic auth versus query parameter) and both have free
  endpoints (account, user data) that must never be metered as paid.

## 2. Types (in `@usagekit/core`, no runtime)

```ts
export type ProviderId = string; // "serpapi", "dataforseo"
export type OperationId = string; // "search", "serp.google.organic.live"

export type ProviderAuth =
  | { kind: "query"; param: string }
  | { kind: "header"; name: string; prefix?: string }
  | { kind: "basic" }
  | { kind: "bearer" };

export type BillingUnit = "cents" | "units" | "requests";

export type ProviderPlan = {
  id: string;
  label: string;
  cycle: "monthly_plan" | "prepaid" | "trial" | "none";
  allowance?: { unit: BillingUnit; value: bigint };
  allowanceMode: "hard" | "soft";
};

export type PriceRow = {
  validFrom: string; // ISO date
  operation: OperationId;
  plan?: string; // plan id; absent = any plan
  option?: Readonly<Record<string, string>>; // request options that select this row
  overage?: true; // applies past the plan allowance
  unit: BillingUnit;
  perUnit: string; // exact decimal in that unit
  source: string; // URL
  checkedAt: string; // ISO date
};

export type RequestMatch = {
  method: "GET" | "POST" | "PUT" | "DELETE" | "ANY";
  path: string; // pattern with :params and *
  query?: Readonly<Record<string, string | RegExp>>;
};

export type ProviderOperation = {
  id: OperationId;
  label: string;
  billable: boolean;
  match: readonly RequestMatch[];
  /** Options that move the price; values are extracted from the request by `options`. */
  optionKeys?: readonly string[];
  /** Cost is known from the response body, only after a later call, or never per call. */
  costEvidence: "response" | "deferred" | "none";
  /** Idempotent replay is safe for this operation when the provider returns the same result. */
  cacheable?: { keyParams: readonly string[]; defaultTtlMs: number };
};

export type BalanceProbe = {
  operation: OperationId; // the free account endpoint
  fields: {
    remaining?: string; // JSON pointer
    remainingUnit?: BillingUnit;
    allowance?: string;
    used?: string;
    resetsAt?: string;
    plan?: string;
    accountIdentity?: string; // e-mail or login, for duplicate detection
    rateLimitPerHour?: string;
  };
};

export type PriceListSource =
  | { kind: "static" } // rows in the descriptor only
  | { kind: "endpoint"; operation: OperationId; pointer: string; mapping: "provider-specific" };

export type BillingExport = {
  kind: "task-history" | "daily-csv" | "none";
  operation?: OperationId; // for API-backed history
  granularity: "per-request" | "per-day";
  matchKey: "providerRequestId" | "window";
};

export type ProviderDescriptor = {
  id: ProviderId;
  label: string;
  upstream: string; // "https://api.example.com"
  auth: ProviderAuth;
  stripRequestHeaders?: readonly string[];
  billing: { unit: BillingUnit; cycle: ProviderPlan["cycle"] };
  plans: readonly ProviderPlan[];
  prices: readonly PriceRow[];
  priceList: PriceListSource;
  operations: readonly ProviderOperation[];
  balance?: BalanceProbe;
  billingExport: BillingExport;
  rateLimits?: readonly { scope: "account"; perMinute?: number; perHour?: number }[];
  docs: { pricing: string; api: string };
};
```

Core also exports `BalanceSnapshot` (optional `remaining`, `allowance`, `used` quantities,
`resetsAt`, `plan`, `accountIdentity`, `rateLimitPerHour`), `BillingLine` and
`validateDescriptor(d)`, which returns a typed list of `DescriptorProblem`: duplicate operation
or plan ids, an operation without `match`, price rows naming an unknown operation, plan or
option key, invalid price fields, a probe on an unknown or billable operation, and a price list
or billing export naming an unknown operation. The catalog refuses a descriptor with problems.

The only code in a descriptor lives beside the data, in the `providers` package. Extractors
take requests and responses as data, not web `Request` and `Response` objects: every extractor
is synchronous, and a request body stream cannot be read synchronously. `extract` returns a
receipt draft; the host wrapper adds the receipt id and timestamps.

```ts
export type ProviderRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
};
export type ProviderResponse = { status: number; headers?: Record<string, string> };
export type ReceiptDraft = Omit<Receipt, "id" | "supersedes" | "occurredAt" | "recordedAt">;

export type Extractors = {
  /** Estimate before the call; empty means no list price. `listEstimate` is the default. */
  estimate(input: {
    operation: ProviderOperation;
    options: Record<string, string>;
    plan?: string;
    overage?: boolean;
    prices: PriceRow[];
  }): Quantity[];
  /** Options that select a price row, read from the request. */
  options(operation: ProviderOperation, request: ProviderRequest): Record<string, string>;
  /** Receipt from the response; body is fully read. Returns unknown cost when evidence is absent. */
  extract(
    operation: ProviderOperation,
    request: ProviderRequest,
    response: ProviderResponse,
    body: unknown,
  ): ReceiptDraft;
  /** Provider request id for replay and reconciliation, when present. */
  requestId(body: unknown): string | undefined;
  /** Parse the balance probe body; without it the catalog reads the declared JSON pointers. */
  balance?(body: unknown): BalanceSnapshot;
  /** Parse a price-list endpoint body into PriceRow[] (for priceList.kind endpoint). */
  priceList?(body: unknown, checkedAt: string): PriceRow[];
  /** Parse a billing export into matchable lines. */
  billingExport?(input: unknown): BillingLine[];
};
export type ProviderModule = { descriptor: ProviderDescriptor; extractors: Extractors };
```

Every extractor is tested against redacted fixtures under
`packages/providers/src/<id>/fixtures/<operation>/<case>.json` with request, response and the
expected receipt draft or parsed value. A fixture file has `origin` (`documentation` when
authored from public API documentation, `recorded` when written by the recorder, `synthetic`
for catalog tests), `provider`, `operation`, `request`, `response` (`status`, `body`) and
`expect` with any of `options`, `receipt`, `requestId`, `balance`, `priceList`
(`{ checkedAt, rows }`) and `billingLines`. Quantities and money are decimal strings. The
folder must name the operation.

A descriptor may advertise an operation only when at least one fixture exists for it.
`runDescriptorConformance(descriptor, extractors, fixturesDir)` from
`@usagekit/providers/testing` enforces that and checks every fixture. Because the package is
web runtime, `fixturesDir` is a map of path to parsed JSON, built in tests with
`import.meta.glob("./fixtures/**/*.json", { eager: true, import: "default" })`.

## 3. Rules

- **Free endpoints are operations too**, with `billable: false`. They are matched, counted and
  never reserved. The balance probe references one of them.
- **Operation identity is the pricing key.** `manual` overrides, tracking policy and budgets
  per operation all key on `OperationId`, never on a raw path.
- **Estimate resolution** per connection: `manual` for (connection, operation), then `measured`
  from that connection's settled receipts when the sample is at least the catalog default (5),
  then the `PriceRow` matching (operation, plan, options, overage state), then `unknown`. A
  plan-priced descriptor with no plan on the connection resolves to `unknown`.
- **Price list from an endpoint** is a refresh source for `prices`, not a replacement: a pull
  request updates the rows with the fetched values and the check date; runtime never fetches
  prices to decide admission.
- **Cost evidence drives lifecycle.** `response`: settle on stream close. `deferred`: settle
  with unknown cost, keep `pending`, resolve through the task-get operation or billing export.
  `none`: settle with the estimate as `estimated`, reconcile from balance deltas or export.
- **Failures can cost money.** The extractor reads provider error codes and marks
  `failed: true` with the charged amount when the provider bills failures.
- **Options are request data, never guessed.** If an option that moves the price cannot be
  read from the request, the estimate falls to the row without that option or to `unknown`.
- **Tracking policy** (`metered`, `passthrough`) lives on the connection, keyed by
  `OperationId`. The catalog exposes `operationsOf(providerId)` so hosts can render the policy.
- **Host allowlist.** `createCatalog({ providers: [...descriptors], enabled: ["serpapi"] })`.
  Disabled descriptors are not matched; their operations are `unpriced`.
- **Account identity** from the balance probe is returned to the host as data. Duplicate
  detection is a host decision.
- **Implementer contract.** The only paid path in a host is the wrapper that takes a
  descriptor and does reserve, dispatch, extract, settle. `@usagekit/providers` ships an
  ESLint rule `usagekit/no-direct-provider-call` configured with the host's client module
  patterns; the rule reports imports of those modules outside an allowlist of wrapper files.

## 4. Catalog API

```ts
const catalog = createCatalog({ providers: [serpapi, dataforseo], enabled: ["serpapi", "dataforseo"], measuredMinSamples: 5 });
catalog.match(providerId, request) -> { operation, options } | { operation: "unknown" }
catalog.estimate(connection, operationId, options) -> { quantities, source: "manual"|"measured"|"list"|"unknown", priceVersion? }
catalog.extract(providerId, operationId, request, response, body) -> ReceiptDraft
catalog.requestId(providerId, body) -> string | undefined
catalog.probe(providerId, body) -> BalanceSnapshot
catalog.parsers(providerId) -> { priceList?, billingExport? }
catalog.operationsOf(providerId) -> ProviderOperation[]
catalog.plansOf(providerId) -> ProviderPlan[]
catalog.proposeBudget(providerId, planId, { namespace, connection, probe?, now? }) -> Budget
```

`connection` in `estimate` is `{ id, provider, plan?, manualPrices?: Record<OperationId, Quantity>,
measured?: (operation) => { quantity, samples } | undefined, overage? }` so the catalog stays
storage-free. `measured` reports its sample size; the catalog uses it only at or above
`measuredMinSamples`. `overage` is true when the host knows the plan allowance is exhausted, so
only `overage` rows apply.

- **Match precedence.** The request must target the upstream origin and base path. Among
  matching operations the longest literal path wins (`:param` segments and a trailing `*`
  count nothing), then the most query constraints, then an exact method over `ANY`.
- **List rows.** A row must name the operation, match the connection plan (rows without a plan
  apply to any plan) and the overage state, and every option it names must equal a request
  option. Plan-specific rows beat any-plan rows, rows naming more options win, then the latest
  `validFrom` not after the catalog date. `priceVersion` is `<provider>:<validFrom>`.
- **Quantities.** A billable estimate always carries one `requests`, so request budgets never
  lack their unit; `unknown` carries only that request, so a money budget blocks it with
  `missing_estimate_unit`. A free operation estimates to nothing. List prices are per call:
  per-result charges are not known before the call and come from the receipt.
- **Proposed budget.** A plan with an allowance becomes a `provider_cycle` budget in the
  allowance unit ending at the probe's `resetsAt` (or one month from today), with an 80 percent
  alert. Hard plans block. Soft plans allow past the allowance with a proposed `hardLimit` at
  twice the allowance. A prepaid plan bounds the probe's `remaining` in a `since_reset` window.

## 5. First two descriptors

**Provider A (per-call cost, prepaid balance, basic auth).** Operations: live SERP advanced,
task post, tasks ready, task get, keyword ideas, keyword suggestions, related keywords, keyword
overview, ranked keywords, domain rank overview, historical rank overview, relevant pages,
backlinks summary, backlinks history, backlinks live, user data (free), labs status (free).
`costEvidence: "response"` for live, `"deferred"` for task post with resolution on task get.
Option `priority` with values `normal` and `high`. Balance probe on user data:
`money.balance` in cents, `login` as account identity, `rates.limits` for rate limits. Price
list source: endpoint `user_data` pointer `price`, mapping by `api.func_type.func_name.priority`
to `OperationId` plus option. Billing export: task-history through the same API, per-request,
matched by task id. Plan: single `prepaid`, `allowanceMode: "hard"`.

Implemented as `dataforseo` in `packages/providers/src/dataforseo/`. Operation ids follow the
path: `serp.google.organic.live.advanced`, `serp.google.organic.task_post`,
`serp.google.organic.tasks_ready`, `serp.google.organic.task_get.advanced`,
`dataforseo_labs.google.<function>.live`, `backlinks.<function>.live`, `appendix.user_data`,
`dataforseo_labs.status`. List rows are the per-task base price in cents, checked on the public
pricing pages; per-result charges come from the receipt. Receipts carry a `cents` measurement
equal to the reported cost, so money budgets settle; a task status of 40000 or more or an HTTP
error marks `failed: true` with the reported charge. `priority` is read from the first task of
the request body: 1 or absent is `normal`, 2 is `high`, anything else is unreadable. The task
post receipt keeps cost unknown with the task id; the billing export parser reads a task get
body into `BillingLine`s (task id, the post operation, the task's cost), which resolve the
pending post through `correct`. The price-list parser maps `price.<api>.<func_type>.<func_name>`
through a key table (for example `serp.task_post.organic`); the documentation example stops
before the price object, so the key layout follows the field schema until a recorded fixture
confirms it. The balance extractor converts `money.balance` from USD to cents and reports
`rates.limits.minute.total` per hour.

**Provider B (no per-call cost, monthly plan, query auth).** Operations: search (paid, unit
`units`, cost evidence `none`, request id from `search_metadata.id`), account (free), locations
(free). Balance probe on account: `plan_searches_left` remaining, `searches_per_month`
allowance, `this_month_usage` used, `plan_renewal_date` reset, `plan_id` plan,
`account_email` identity, `account_rate_limit_per_hour`. Plans from the public pricing page as
static rows with `allowanceMode: "hard"` inside the plan and `extra_credits` modelled as a
second `prepaid` plan row for overage; no per-call cost means settlement is `estimated: 1 unit`
and reconciliation compares `this_month_usage` deltas. Billing export: `none`.

Implemented as `serpapi` in `packages/providers/src/serpapi/`. Plans are the named tiers of
the public pricing page, checked 2026-09-25 (`free` 250, `starter` 1,000, `developer` 5,000,
`production` 15,000, `bigdata` 30,000, `searcher` 100,000, `volume` 250,000, `infrastructure`
500,000 searches per month); cloud and enterprise tiers are manual prices on the connection.
Plan ids other than `bigdata` (the account API example) are assumed until a recorded probe
confirms them. Every plan prices `search` at one unit; an `overage` row without plan prices the
extra credit drawn past the allowance, and `extra_credits` is the prepaid plan. A search
receipt is one estimated unit plus one measured request with zero estimated money: the plan
fee is not a per-call charge, so money inside a plan is never guessed per call. An errored
search consumes zero units. The balance probe uses the declared JSON pointers without an
extractor override.

## 6. Fixture recorder (local server)

`POST /providers/connections/:id/record` with `{ operation, request }` performs one real call
through the vault key, redacts secrets and account identity, stores request and response under
`<config-dir>/fixtures/<provider>/<operation>/<uuid>.json`, and returns the path. The CLI
exposes `usagekit provider record`. Recording follows the connection policy: billable metered calls reserve and settle, while free
and passthrough calls are counted without a reservation. The recorded file
is the input format the descriptor test suite expects, with an empty expectation to fill in
independently. See [contributing providers](CONTRIBUTING-PROVIDERS.md).

## 7. Exit gate for P5

- Types in core, `@usagekit/providers` with both descriptors, every advertised operation has a
  fixture and a passing extractor test, price list parser for provider A tested on a fixture,
  balance parsers for both tested, `proposeBudget` produces a valid `Budget` for each plan.
- Catalog tests: match precedence, unknown path, disabled provider, estimate resolution order
  on all four sources, deferred cost lifecycle in the memory store through Meter.
- Local server: connection `plan` and `tracking` fields, `provider record` command, catalog
  wired into `report reserve` so the estimate comes from the catalog when `--estimate` is
  omitted.
- Lint rule packaged and tested on a fixture project.
- Docs: `PROVIDERS.md` (this design, updated), `CONTRIBUTING-PROVIDERS.md` (how to add one:
  descriptor, fixtures, tests, price source, checked date).

## 8. Executable wrapper and local pricing

`executeProviderRequest` is the shared reserve, dispatch-intent, transport, extraction and
settlement wrapper. Callers supply the Meter, Catalog, trusted scope and an operation ID.
Only the first grant dispatches. Replays, unknown routes and denied reservations never call
the transport. Inject credentials in the transport callback and finish reading the response
before it resolves. Transport failures retain unknown cost in a pending operation. Accounting
failures are returned separately so hosts can recover them without repeating the paid call.
Deferred evidence still requires the host's later correction; a reconciliation worker is P8.

Local connections accept `manualPrices` as operation-keyed wire quantities (`value` is an
integer string, `scale` is 0..18, `unit` is the provider's billing unit), and an explicit boolean
`overage`. Omitted fields survive key rotation; an empty price map removes manual overrides.
Overage comes from a confirmed allowance state, not a guessed balance. The local server uses
an upper median of successful, uncached, measured, settled receipts from the same connection
and operation in the preceding 30 days. Five samples are required. A truncated 1,000-operation
sample falls back to list pricing. Prices are estimates across the operation's observed options;
hosts requiring option-specific forecasts should keep their own explicit estimates.

The default coverage view now combines Meter usage with persisted passthrough, unpriced,
cached and rate-limited counters. Without an external CoverageSource, select whole UTC days.
Forbidden or incomplete counter reads produce an unavailable/forbidden view, never a zero.
