# Provider UI and headless hooks

Provider administration is a host capability. The Meter owns accounting reads; it does not
store provider credentials, configure OAuth, route connections or own customer wallets.
The React layer composes both capabilities without introducing another balance authority.

`@usagekit/views` exports provider DTOs and the `ProviderManagementPort` contract.
`@usagekit/react` consumes that port without styling. Registry blocks render the same
models with Radix/New York or Base UI primitives. All UI workspaces remain private;
see [consuming packages](CONSUMING.md) for the checkout workflow.

## Host adapter

A `ProviderBinding` identifies the current scope, principal and authorization revision.
`scopeKey` must qualify the host service, namespace and tenant whose command journal owns
the action. Two independent backends must never reuse a scope key for the same principal.
`canManage` enables UI actions only when explicitly true. These values fence local reads
and callbacks; the server must authenticate and authorize every read, execute and reconcile
request independently. Never accept a browser-supplied binding as an access grant.

The host supplies three operations:

- `read(binding, query)` returns stored evidence for connections, connection details,
  balances, cost projections or allocations. A read must not test credentials, refresh a
  provider balance through a paid API or dispatch a provider request.
- `execute(binding, command, secrets?)` performs one explicit action. It validates the
  command identifier, target, capabilities, current revision and native storage bounds.
  Configuration changes use optimistic concurrency. Allocation batches require an atomic
  transaction across the submitted rows, or a definitive rejection without partial changes.
- `reconcile(binding, command)` consults the host command journal. It never retries the
  action. `not_applied` requires authoritative proof, not an absent connection in a read.

Commands cover connect, test, reconnect, disconnect, funding source, connection settings,
rates and allocation batches. Testing a draft credential does not create a connection.
All results echo the command identifier. Existing targets and allocation rows carry their
expected revision; the host rejects stale versions instead of overwriting them.

Provider credential values travel only in the ephemeral third argument of `execute`.
They never belong in read DTOs, query keys, command bodies, reconciliation requests or
error copy. OAuth and credential-vault references remain host-owned. Do not log secrets;
the host should return safe, localized error descriptions.

## Shared reads and explicit actions

Wrap related panels in `ProviderManagementProvider`, passing one stable port and the
current binding. Standalone hooks also accept the port and binding directly. Equal reads
share a bounded cache; changing identity or authorization selects a separate read state.
No hooks require registry components or CSS.

Provider actions run only after an explicit call. Pending and ambiguous actions keep a
shared gate, including after an editor is remounted or its read cache or adapter is replaced.
There is no automatic provider retry.
An ambiguous result requires manual reconciliation before another action can run. A stale
callback must not invoke an old adapter after the binding changes. Read-only is the default.

The provider cache is separate from the Meter cache. Hosts should refresh or invalidate
accounting reads after external changes to usage or financial authorities. Successful
provider configuration actions invalidate provider reads.

## Exact limits and separate authorities

An allocation row has its own funding source, surface, unit and revision. In the common
configuration, rows form a two-by-two matrix: own provider keys and platform-funded keys,
each with app and programmatic access. An omitted limit keeps the stored value; `null`
clears a limit. An unlimited row differs from a row whose limit is unavailable.

Native provider usage, provider cost and customer charges must remain separate. A host
wallet balance is not a provider balance. Do not add rows in different units or funding
sources. Exact decimal strings survive values above JavaScript's integer precision.
`parseProviderDecimal` supplies generic validation; the host also enforces its own native
precision, maximum allocation and monetary bounds.

`allocationLimitFromAvailable` suggests a limit from measured usage, reservations and
availability in one unit. The host explicitly declares whether availability is before or
after those reservations. Before-reservation availability produces `used + available`;
after-reservation availability produces `used + reserved + available`. Unknown, estimated,
unavailable and incompatible figures cannot silently become zero or a usable suggestion.
The suggestion changes an editor draft only; it never refreshes or mutates a balance.

`projectBudgetExhaustion` estimates exhaustion from settled average pace and remaining
headroom. Reservations consume headroom without increasing settled pace. It returns
no usage, already exhausted, within limits, an estimated timestamp or unavailable. A
forecast is an estimate, not an admission decision or a promise about future spending.

## Host adoption

A host adapter maps its provider catalog and connection read state into the DTOs, its
provider actions into `execute`, and its versioned action journal into `reconcile`.
Authorization, credential encryption, OAuth, provider dispatch, fallback policy, billing
and wallet writes stay in the host. Labels and primitive components are replaceable.

The local showcase uses an isolated example adapter and never contacts a provider.
Passing its tests verifies library composition; it does not establish production adoption
or authorize a release. See [UI layers](UI.md) and [the project website](SITE.md).

## Two application consumers

Bisibility and the Usagekit dashboard are the intended consumers of the same React hooks
and registry blocks. Changes to shared behavior belong in this library. Each application
supplies its verified identity, adapters, labels, primitives and product-specific slots.
Neither application should maintain a second implementation of provider or budget editors.

The local dashboard under `packages/server/ui` consumes unchanged Base UI registry blocks
for accounting, provider cards, credential forms, rate editing and budget management.
Its parity test checks copied sources against the registry. Its authenticated host adapters
support own-key connections, format-only tests, exact manual prices and versioned budgets.
The server supplies connection CAS revisions and a durable content-free command journal;
budget reconciliation reads immutable version evidence. Unsupported capabilities stay hidden.
See [local dashboard controls](LOCAL-SERVER.md#dashboard-controls) for the API and restart rules.

Bisibility's existing metering integration is the public example. Adoption of these new
React blocks is still pending. Its application adapter keeps OAuth, credential storage,
funding permissions and wallet ownership in the application while projecting neutral DTOs
into the shared UI. Both integrations should exercise the same read-only, exact-value,
conflict and unknown-result cases before replacing their current screens.
