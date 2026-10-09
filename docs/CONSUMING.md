# Consuming usagekit

Use Node 22.23.1 and pin packages from a release cohort to the same exact version.
The seven-package 0.6.0 cohort is published and includes views, React and Postgres storage.
The four-package 0.5.0 runtime cohort remains available as the preceding version.
The seven-package 0.7.0 source cohort adds `useProviderEditor` to `@usagekit/react`; the other
six packages move to 0.7.0 without functional changes.
Use the npm commands below for 0.6.0 and reviewed local tarballs for 0.7.0 until it is published.

Source: <https://github.com/msniezynski/usagekit>. Documentation and registry: <https://usagekit.dev>.

```sh
npm install --save-exact @usagekit/core@0.6.0 @usagekit/store@0.6.0 @usagekit/meter@0.6.0 @usagekit/providers@0.6.0
```

The registry is `https://registry.npmjs.org/`. No scope registry mapping is needed.
The packages are public. No registry token is required to install them.
Consumers that configured a read-only token during the private phase should verify a token-free `npm ci` and then remove the token from CI, deployment and user configuration.
For an unpublished candidate, install the reviewed cohort tarballs together as described below.
Consumers upgrading from 0.4.0 must follow the [migration guide](MIGRATING-0.5.md): custom Store
and Meter implementations need the mandatory billing methods; the interfaces are not interchangeable.

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

`@usagekit/views` and `@usagekit/react` belong to the seven-package 0.7.0 source cohort,
alongside `@usagekit/store-postgres`; the published 0.6.0 cohort has the same seven packages.
In 0.7.0, `@usagekit/react` adds `useProviderEditor(query, options?)`, which keeps a draft base
separate from current evidence and rebases only after an explicit successful reload; see
[provider UI](PROVIDER-UI.md). Keep packages on the same exact cohort; do not mix 0.6.0 and
0.7.0 packages. The component registry is private build tooling that distributes public shadcn
JSON, rather than an npm package.

Check availability without credentials:

```sh
for package in core store meter providers views react store-postgres; do
  npm view "@usagekit/$package@0.6.0" version --registry https://registry.npmjs.org/
done
```

After all seven versions are available, install the packages your application needs:

```sh
npm install --save-exact @usagekit/core@0.6.0 @usagekit/store@0.6.0 @usagekit/meter@0.6.0 @usagekit/providers@0.6.0 @usagekit/views@0.6.0 @usagekit/react@0.6.0
# Optional server-side Postgres storage:
npm install --save-exact @usagekit/store-postgres@0.6.0
```

Registry blocks request exact 0.7.0 `@usagekit/react`, `@usagekit/views` and `@usagekit/core`
versions, which resolve anonymously only after 0.7.0 is published. Run the check above with
0.7.0, then pin every `@usagekit` package in the application to 0.7.0 before copying blocks:

```sh
# Choose the primitive family configured in your shadcn application:
npx shadcn add https://usagekit.dev/r/radix/budget-manager-panel.json
# Or: npx shadcn add https://usagekit.dev/r/base/budget-manager-panel.json
# Any shadcn style: add "@usagekit": "https://usagekit.dev/r/styles/{style}/{name}.json" to
# "registries" in components.json, then: npx shadcn add @usagekit/budget-manager-panel
```

If a version is unavailable, use the reviewed seven-tarball candidate workflow below.
A successful website deployment does not establish npm publication.
Backend consumers need no React dependency unless they install the React package.

From a checkout, run the root `npm ci` and `npm run build`. A workspace host can use
`loadUsageSummary` and the other views directly, or share reads through `MeterProvider`
and the React hooks. The copied blocks use the host's primitives, and their own elements follow
the host's shadcn style: New York, or Vega, Nova, Maia, Lyra, Mira, Luma, Sera or Rhea on Radix
or Base UI when copied from `r/styles/{style}`; `r/radix` stays New York and `r/base` stays
Base UI Vega. Registry artifacts contain their dependency manifest and bundled
component files. Published UI dependencies resolve anonymously from npm; unreleased
candidates require the reviewed tarballs before copying blocks.

For a complete local example without package downloads:

```sh
node packages/registry/consumers/prepare.mjs
```

Run the printed Vite command to open the showcase on loopback port 5177. One page shows every
block and switches all seventeen shadcn styles in place. The preparation copies the blocks,
primitives and style sheets into an ignored host directory and resolves the local workspace
source. The showcase uses one in-memory Meter and a sample budget writer; it includes light/dark
themes, read-only mode and exact budget inputs. It does not access an external provider or
production database.

Use a stable, memoized host `BudgetWriter` to enable edits. Its server implementation must
verify authorization, preserve allowed scope/unit/window and use budget version
compare-and-swap. A timed-out write stays unknown until authoritative reconciliation;
never translate a missing read into permission to retry. Read-only is the default, and
customer credit authority remains in the host. See [UI](UI.md) for APIs, all twenty-two blocks,
shared cache behavior and writer outcomes.

## Release operators

Only `npm run release` can publish the allow-listed core, store, meter, providers, views, react
and store-postgres packages. Other workspaces stay private. The 0.7.0 candidate requires
separate approval of its exact SHA, squash title and seven public versions before promotion.
Live release requires clean main, its verified signed v0.7.0 tag, full checks, inspected
tarballs and a token-free consumer installation that checks declarations and React rendering.
A dry run on a clean branch builds and audits packages without checking live authorization or publishing.
Apache-2.0 LICENSE and NOTICE are included in every tarball.

## Trying the 0.7.0 candidate

From its reviewed checkout, run `npm ci`, `npm run check`, `npm run build`,
`npm run check:packages` and `npm run check:consumer`. The last command packs all seven
packages, installs them into a disposable directory outside the repository with empty npm
configuration, compiles a strict TypeScript consumer and renders React on the server. It
uses the registry only for pinned external dependencies and never calls a provider.

To use the candidate in your own test application, run `npm pack --workspace <name>` for
each of the seven allow-listed packages and install those seven resulting tarballs together
with React 19 if you use the UI. Avoid `npm link`: it can hide missing package files and
resolve dependencies from the checkout. The existing 0.5.0 migration rules still apply to
custom Stores and Meters. Neither the 0.6.0 adapters and UI nor the 0.7.0 `useProviderEditor`
hook changes that accounting contract.
