# UI layers

All seven packages, including `@usagekit/react`, `@usagekit/views` and
`@usagekit/store-postgres`, are published at 0.6.0. The registry remains
private build tooling whose blocks are distributed as public copyable JSON.
Verify exact npm versions before installing a cohort; use reviewed tarballs for unreleased
candidates. See [consuming packages](CONSUMING.md) for both workflows.

| Layer                  | Package or path                                      | Depends on                         | Runs in                   |
| ---------------------- | ---------------------------------------------------- | ---------------------------------- | ------------------------- |
| Headless views         | `@usagekit/views`                                    | core                               | Servers and browsers      |
| Hooks and shared cache | `@usagekit/react`                                    | views, React 19                    | A React tree with a Meter |
| Copyable blocks        | `packages/registry`                                  | hooks, the host's `ui/` primitives | The host's React tree     |
| Pages                  | Host code; `packages/server/ui` for the local server | Selected blocks                    | The host                  |

Authentication, verified access, routes, budget persistence and customer credit balances
belong to the host. A backend-only consumer does not need any UI layer.

## Headless views

Every loader takes a Meter, verified `AccessContext` and input. Use these on the server
without React, or render the returned models with your own design system.

| Loader                   | Input                                                    | Returns              |
| ------------------------ | -------------------------------------------------------- | -------------------- |
| `loadUsageView`          | `UsageQuery`                                             | `UsageView`          |
| `loadUsageSummary`       | usage query without cursor/grouping; optional `maxPages` | `UsageSummaryView`   |
| `loadBudgetsView`        | scope, surface, units, pools, source, crossings          | `BudgetsView`        |
| `loadDefinedBudgetsView` | `DefinedBudgetsQuery`                                    | `DefinedBudgetsView` |
| `loadHeaderStatus`       | same as applicable budgets                               | `HeaderStatus`       |
| `loadCoverageView`       | scope, from, to, optional coverage source                | `CoverageView`       |
| `loadExceptionsView`     | scope, from, to, limit, cursor                           | `ExceptionsView`     |

```ts
import { loadUsageSummary, loadDefinedBudgetsView } from "@usagekit/views";

const summary = await loadUsageSummary(meter, verifiedAccess, {
  scope: verifiedScope,
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-11-01T00:00:00.000Z",
  units: ["requests", "tokens", "customer_cents"],
});
const definitions = await loadDefinedBudgetsView(meter, verifiedAccess, {
  scope: verifiedScope,
});
```

Amounts contain exact `text`, `unit` and `certainty`; never convert the text to a number.
Money uses cents with four fractional digits. Measured zero, estimated values, unknown
measurements and unavailable figures have separate presentations. Unknown has empty text;
unavailable is not zero. A forbidden or failed read must not display stale figures.

Summary loading follows bounded pagination with one watermark and observation time.
`complete: false` makes totals unavailable rather than presenting a partial sum as complete.
`rowCount` counts aggregate rows, not operations. Provider `cost` and funding/cost-owner
breakdowns stay separate from the optional `customer_cents` measurement; this UI does not
calculate customer charges or wallet balances.

Budget status shows used and reserved amounts separately. A block budget is exceeded at
its limit; an allow budget warns at its soft limit and is exceeded at its hard limit.
Alert crossings and the default 80 percent warning are shown without changing admission.
Redacted shared budgets remain visible without amounts. Exceptions expose expired
reservations, expired leases and pending work with age at the page's `asOf`.

## React hooks and shared reads

Wrap related panels in one `MeterProvider`. The default per-provider cache shares equal
reads, has a 30 second stale time and retains at most 128 inactive entries. A host can supply
one stable `createMeterQueryClient({ staleTimeMs, maxEntries })` instance explicitly.
Keys include Meter identity, verified access, loader and query. Changing scope, account or
Meter immediately isolates the rendered state; old requests cannot fill the new binding.

Hooks return `data`, `state`, `error`, `refresh()` and `refreshing`. Initial loading differs
from an unavailable or forbidden read. Refreshing can retain valid data within the same
binding. Use `queryClient.invalidate(meter, verifiedAccess)` after external accounting
changes; successful budget mutations invalidate that binding automatically.

```tsx
import { useMemo } from "react";
import { MeterProvider, createMeterQueryClient } from "@usagekit/react";
import type { BudgetWriter } from "@usagekit/react";
import { saveAuthorizedBudget, reconcileAuthorizedBudget } from "./budget-api";

function UsagePage({ meter, verifiedAccess, children }) {
  const queryClient = useMemo(() => createMeterQueryClient(), []);
  const budgetWriter = useMemo<BudgetWriter>(
    () => ({ save: saveAuthorizedBudget, reconcile: reconcileAuthorizedBudget }),
    [],
  );
  return (
    <MeterProvider
      meter={meter}
      access={verifiedAccess}
      queryClient={queryClient}
      budgetWriter={budgetWriter}
    >
      {children}
    </MeterProvider>
  );
}
```

Keep the writer stable across renders. Read access is still enforced by the Meter and the
host transport; a browser-supplied scope or `canManageBudgets` is not server authorization.
A remote Meter may use a read-only `createUsageHandlers({ commands: false })` mount.
The budget writer is a separate host adapter, not a new Meter write endpoint.

## Budget editing

`useBudgetEditor` and `BudgetEditor` accept an existing Budget, or a host-authored
`BudgetTemplate` containing id, version, scope, surface, unit and window. Version zero is a
create template; a save builds version one. Editing builds the next version. The draft
contains exact decimal strings for limit, optional hard limit and alert quantities. It
cannot change the trusted scope, unit, id or window.

Editing is disabled by default. Both a writer and `canManageBudgets` are required to enable
it. The host writer must independently authorize the caller, validate the allowed template
and perform version compare-and-swap in its own persistence transaction.

The writer returns `saved`, `conflict`, `invalid`, `forbidden` or `unavailable`. A conflict
keeps the draft; the manager offers an explicit reload of the latest version before a new
edit. Invalid input shows the field and reason without calling the writer. Choosing Block
or No limit clears an incompatible hard limit. Percent alerts remain visible so an
unlimited budget can remove them or choose quantity thresholds.

A pending or ambiguous save freezes the submitted values and disables duplicate writes,
reset and draft edits. An ambiguous result offers **Check save status**. The writer's
`reconcile` may confirm saved, conflict or explicitly not saved. Without it, a defined-budget
read can confirm the exact saved version or a conflict; an absent or older row cannot prove
that the write did not happen. Replacing a writer or remounting an editor does not clear an
unknown write. No automatic write retry, budget deletion or wallet mutation is supplied.

`BudgetManagerPanel` lists definitions and opens the selected editor. Creation choices come
only from the host's matching version-zero templates. Pass `budgetTitles`, template titles
and labels to provide application copy; all strings have English defaults.

## Copyable registry blocks

Both Radix/New York and Base UI/base-vega contain the same twenty blocks:

| Block                        | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `measurement-card`           | One exact figure with certainty                          |
| `usage-summary-cards`        | Complete totals by measurement unit                      |
| `cost-summary-card`          | Provider cost and funding/cost-owner breakdown           |
| `usage-table`                | Detail and cursor pagination                             |
| `budget-card`                | Applicable budget usage, reservations, alerts and bounds |
| `budget-editor`              | View or edit one trusted definition/template             |
| `budget-manager-panel`       | Browse, reload, edit and create from host templates      |
| `header-status`              | Compact applicable-budget status, including empty state  |
| `coverage-summary`           | Tracked and untracked coverage                           |
| `exceptions-list`            | Work needing evidence or recovery                        |
| `usage-filters`              | Controlled period and scope choices                      |
| `connection-list`            | Funding, tags and plan per connection                    |
| `provider-card`              | Connection status, availability and explicit actions     |
| `provider-connect-form`      | Draft credentials, test, connect and reconnect           |
| `provider-source-selector`   | Own-key or platform funding with explicit confirmation   |
| `provider-rate-editor`       | Exact rates, measured/manual/list provenance and editing |
| `provider-chain-editor`      | Enable connections and edit fallback ordering            |
| `provider-balance-card`      | Separate provider or host-wallet balance and freshness   |
| `provider-allocation-editor` | Funding-by-surface limits and availability suggestions   |
| `provider-manager-panel`     | Compose connection, rate, funding and allocation tools   |

Provider blocks use a separate host-owned `ProviderManagementPort`. They do not infer
provider credentials, connection ownership, prices or wallet balances from Meter reads.
Headless hooks provide connection, balance, quote and allocation reads plus explicit
administrative actions. See [provider UI](PROVIDER-UI.md) for the adapter contract,
concurrency, reconciliation and exact-limit semantics.

Data-driven blocks expose pure components and hook-backed Panels where applicable.
Filters and connection lists take host data. Styling uses the host's semantic tokens;
there is no bundled stylesheet or second theme. Labels, accessible field names and titles
are overridable. Error, forbidden and empty states are distinct from loading.

```sh
npm run registry:build
npx shadcn add ./packages/registry/dist/r/radix/budget-manager-panel.json
npx shadcn add ./packages/registry/dist/r/base/usage-summary-cards.json
```

Each JSON artifact declares package dependencies, host primitives and all copied files.
The manager bundles its editor; summary cards bundle their measurement card. Files land in
`@/components/usagekit/` and import `@/components/ui/*`. Root `r/<name>.json` defaults to
Radix. Tooltip triggers and selects have variant-specific files; other block source is shared.
The shadcn CLI requests exact 0.6.0 UI package versions, available anonymously on npm.
The [public examples](https://usagekit.dev/examples/) link both complete dashboards and
provide each block's install command. See [consuming packages](CONSUMING.md) for local
tarball validation of unreleased candidates.

To use another design system, copy every artifact file and replace the listed table, card,
badge, button, tooltip, select, input and label imports with equivalent host primitives.
Keep the view model semantics, exact text and accessible labels.

## Local showcases and coverage

After the root `npm ci`, prepare complete local dashboards without downloads or publication:

```sh
node packages/registry/consumers/prepare.mjs
```

The command prints two Vite invocations for `http://127.0.0.1:5177` (Radix) and
`http://127.0.0.1:5178` (Base UI). Both use the copied blocks, one in-memory Meter,
sample host adapters, light/dark controls and a view-only switch. Fixtures and generated
copies stay local; they make no provider calls. Use them for desktop/mobile review.

`loadCoverageView` accepts a `CoverageSource` for bigint counts of metered, passthrough,
unpriced, cached and rate-limited requests. Without it, the Meter's tracked requests are
shown and other counts remain unavailable. The Meter read authorizes the scope before the
coverage port runs. `createMemoryCoverageSource` is available for tests and demos.

The existing local server builds its Base UI page with `npm run build` and serves it at `/`.
Its bearer token is kept in memory; reloading asks for it again.
