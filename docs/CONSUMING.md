# Consuming usagekit

Use Node 22.23.1 and pin the four public packages to the same exact version.
The published cohort is 0.5.0; 0.4.0 is the preceding published version.

```sh
npm install --save-exact @usagekit/core@0.5.0 @usagekit/store@0.5.0 @usagekit/meter@0.5.0 @usagekit/providers@0.5.0
```

The registry is `https://registry.npmjs.org/`. No scope registry mapping is needed.
The packages are public. No registry token is required to install them.
Consumers that configured a read-only token during the private phase should verify a token-free `npm ci` and then remove the token from CI, deployment and user configuration.
For an unpublished candidate, install all four reviewed local tarballs together as described in
the [migration guide](MIGRATING-0.5.md). Custom Store and Meter implementations need the new
mandatory billing methods before upgrading; the 0.4.0 interfaces are not interchangeable.

## Embedded contract

Create an in-process Meter with a host Store, policy and injected clock.
Authorize writes in the host. Build read AccessContext from verified server credentials.
Reserve before dispatch. Only a first dispatch grant allows a provider call.
Reservation lifetime defaults to five minutes and has a maximum of one day.
Queue producers must obtain intent at enqueue and carry the lease, or cover queue delay in the lifetime.
An expired reservation cannot dispatch and is atomically released when intent is attempted.
Schedule expireReservations for each namespace; repeat batches while hasMore is true.
Admission cleans only one default batch. Embedded consumers own remaining maintenance.
The local server schedules cleanup every thirty seconds.
Expired dispatch leases require evidence recovery; never redispatch or release uncertain exposure.
Reconcile external credit holds through their authoritative ledger.

## Budget alerts

A budget may declare up to eight ascending `alerts`, each a percent of `limit` or a quantity in the budget unit.
The reserve, settle or correct whose admitted or settled figures first reach a threshold returns it in `alerts`
with the budget id, version, epoch, threshold and the figures at that moment. The store records the crossing
atomically with the command, so concurrent commands report it once in total, a replay returns the stored
crossings, and a new epoch reports the threshold again. Soft budgets (`onExceed: "allow"`) still warn past
`limit` and deny past `hardLimit`; alerts never change admission.

## Read-only HTTP mount

`createUsageHandlers({ meter, authenticate, commands: false })` serves only the read routes. Every POST under
`/v1/operations/`, including `expire`, answers 404 after authentication and before any authorization or body
parsing. An embedded host mounts it on one authenticated route, maps its own sessions or API keys to
`AccessContext` in `authenticate`, and an external dashboard consumes it through `createRemoteMeter`, whose
command methods then reject with `RemoteHttpError` 404. Operations stay created in process.

## Adapter conformance

Runtime imports use @usagekit/store. The reference implementation is also exported at /reference.
Import runStoreConformance and runStoreScalingConformance from @usagekit/store/conformance.
The conformance entry ships compiled JavaScript and declarations, not TypeScript sources or test runners.
Consumers running it provide compatible vitest 5 and fast-check 4 peers as development dependencies.
Every case uses the supplied factory. Durable adapters must implement the restart fixture.
Skipped capabilities are not passed guarantees.

## Headless views and React components

`@usagekit/views`, `@usagekit/react` and the component registry are private workspaces.
They are usable locally in this repository but are not part of the published 0.5.0 cohort.
Do not depend on anonymous npm installation of those names until a separate UI release is
approved. Existing consumers of the four public runtime packages need no UI dependencies.

From a checkout, run the root `npm ci` and `npm run build`. A workspace host can use
`loadUsageSummary` and the other views directly, or share reads through `MeterProvider`
and the React hooks. The copied blocks use host primitives for either Radix/New York or
Base UI/base-vega. Registry artifacts contain their dependency manifest and bundled
component files; the CLI still needs a local/private source for the UI packages.

For a complete local example without package downloads:

```sh
node packages/registry/consumers/prepare.mjs
```

Run the two printed Vite commands to open the dashboards on loopback ports 5177 and 5178.
The preparation copies every registry artifact into ignored consumer directories and
resolves the local workspace source. Both dashboards use a shared in-memory Meter and a
sample budget writer; they include light/dark themes, read-only mode and exact budget
inputs. They do not access an external provider or production database.

Use a stable, memoized host `BudgetWriter` to enable edits. Its server implementation must
verify authorization, preserve allowed scope/unit/window and use budget version
compare-and-swap. A timed-out write stays unknown until authoritative reconciliation;
never translate a missing read into permission to retry. Read-only is the default, and
customer credit authority remains in the host. See [UI](UI.md) for APIs, all twelve blocks,
shared cache behavior and writer outcomes.

## Release operators

Only npm run release can publish core, store, meter and providers. Other workspaces stay private.
Live release of this cohort requires clean main, its verified signed v0.5.0 tag, full checks and inspected tarballs.
A dry run on a clean branch builds and audits packages without checking live authorization or publishing.
Apache-2.0 LICENSE and NOTICE are included in every tarball.
