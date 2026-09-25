# UI layers

usagekit ships four UI layers. Take as many as fit the host. Backend only stays complete.

| Layer            | Package or path                                      | Depends on        | Runs in                  |
| ---------------- | ---------------------------------------------------- | ----------------- | ------------------------ |
| View models      | `@usagekit/views`                                    | `@usagekit/core`  | Server code and browsers |
| Hooks            | `@usagekit/react`                                    | views, React 19   | Browsers with a Meter    |
| Reference blocks | `packages/registry` (shadcn)                         | hooks, host `ui/` | The host's React tree    |
| Pages            | Host code; `packages/server/ui` for the local server | blocks            | The host                 |

## When to use each

- **View models, always.** Money text, certainty, unavailable states and cursors are where
  hand-written panels go wrong. Server-rendered hosts call them from server code and stop here.
- **Hooks** when the browser holds a Meter, usually `createRemoteMeter` against a read-only
  mount (`createUsageHandlers({ commands: false })`). Wrap pages in `MeterProvider`.
- **Blocks** when the host uses shadcn primitives or wants a starting point to copy.
- **Pages** are always the host's: authentication, authorization, audit, routing, copy.

## View model contract

Every loader takes a `Meter`, a verified `AccessContext` and an input, and returns data.

| Loader               | Input                                           | Returns          |
| -------------------- | ----------------------------------------------- | ---------------- |
| `loadUsageView`      | `UsageQuery`                                    | `UsageView`      |
| `loadBudgetsView`    | scope, surface, units, pools, source, crossings | `BudgetsView`    |
| `loadHeaderStatus`   | same as budgets                                 | `HeaderStatus`   |
| `loadCoverageView`   | scope, from, to, optional `CoverageSource`      | `CoverageView`   |
| `loadExceptionsView` | scope, from, to, limit, cursor                  | `ExceptionsView` |

- Amounts are `{ text, unit, certainty }` built with `formatQuantity` and `formatMoney` from
  core. They are never numbers. Money uses the unit `cents` with four fractional digits.
- `"unavailable"` marks a figure that is missing, forbidden or redacted. It is never zero.
  An unknown figure has certainty `unknown` and empty text; render your own label.
- `state` is `ok`, `empty`, `forbidden` or `unavailable`. A Meter that throws or answers
  `invalid` gives `unavailable` with a `problem`. Redacted shared budgets stay visible as rows
  with `redacted: true`, level `unavailable` and no figures.
- Header levels: `exceeded` at the limit (or the hard limit of an `allow` budget), `warning`
  past the soft limit, at any crossed alert, or at 80 percent when no alerts exist. Pass the
  `alerts` of the last reserve, settle or correct as `crossings` to refresh in the same request.
- Exceptions come from `Meter.listOperations`: expired undispatched reservations, expired
  dispatch leases, and pending work awaiting evidence, with age at the page's `asOf`.
- `BudgetRow.bar` gives bar geometry as percent text, so no component converts text to numbers.

## Registry blocks

Seven blocks: `usage-table`, `budget-card`, `header-status`, `coverage-summary`,
`exceptions-list`, `usage-filters`, `connection-list`. Each exports a component over a view
model and a `...Panel` that reads it with the matching hook. Labels are props with English
defaults. Styling uses semantic tokens only.

```sh
npm run registry:build                       # packages/registry/dist/r
npx shadcn add ./packages/registry/dist/r/radix/usage-table.json   # Radix hosts (new-york)
npx shadcn add ./packages/registry/dist/r/base/usage-table.json    # Base UI hosts (base-vega)
```

`r/<name>.json` defaults to Radix. Files land in `@components/usagekit/` and import the host's
own `@/components/ui/*` primitives; the CLI installs `@usagekit/react`, `views` and `core`.
Only `budget-card`, `header-status` (tooltip trigger) and `usage-filters` (select) differ
between the two families; the other blocks are one shared file.

## Rebinding for a host design system

Each item's `docs` lists the primitives it imports. To rebind:

1. Copy the block file, or read it from `dist/r/<variant>/<name>.json`.
2. Replace each `@/components/ui/<name>` import with your component of the same role: table
   parts, card parts, badge, button, tooltip parts, select parts.
3. Keep the view model props and the label objects; keep amount text as given.
4. Or skip the blocks and write your own component over the view model and hooks.

## Coverage port

The store keeps no per-state request counter yet. `loadCoverageView` takes an optional
`CoverageSource` with `counts(scope, from, to)` returning bigint counts for `metered`,
`passthrough`, `unpriced`, `cached` and `rate_limited`. Without it, the view reports the
meter's own metered requests and marks the other states unavailable. The local server fills
this port when the proxy and the per-state counter exist (P5 and P6);
`createMemoryCoverageSource` serves tests and demos. The Meter read always runs first, so the
port never widens access.

## Local server UI

`npm run build` builds `packages/server/ui` into `packages/server/dist/ui`, served at `/`.
It uses the Base UI blocks. The token is entered once, kept in memory and sent as a bearer
header; reloading the page asks again.
