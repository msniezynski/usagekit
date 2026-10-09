---
name: add-provider
description: Add a usagekit provider descriptor so the local server, proxy and hosts can meter a new API. Covers operations, plans and sourced prices, extractors, fixtures and conformance tests. Use when someone wants usagekit to meter an API it does not bundle yet.
---

# Add a provider descriptor

A descriptor is data plus a few small pure functions that tell usagekit how to match, price,
meter and reconcile one API. DataForSEO and SerpApi are bundled; every other API needs its own
descriptor in `packages/providers/src/<provider>/`. The specification is
[docs/PROVIDERS.md](../../../docs/PROVIDERS.md) and the contribution checklist is
[docs/CONTRIBUTING-PROVIDERS.md](../../../docs/CONTRIBUTING-PROVIDERS.md). Read both before
writing code; this skill is the order of work.

Never make a paid provider call on your own. Tests use fixtures only. Recording a real response
(`usagekit provider record`) performs one real call that can incur a charge, so it needs the
user's explicit approval for that exact request.

## 1. Collect the facts

Write down, with a source URL for each:

- Base URL and authentication (header, basic auth or query parameter). Never put credentials in
  the descriptor.
- Every endpoint the user will call, split into paid and free (account, metadata, task lookups).
  Free endpoints are operations too, with `billable: false`.
- How the API charges: per call in money, plan allowance in units, prepaid credits or overage.
  Note whether a failed call is charged.
- Whether a response reports its cost (`costEvidence: "response"`), reports it later through a
  task or billing export (`"deferred"`), or never (`"none"`).
- An account or balance endpoint and the JSON fields for remaining, used, allowance, plan and
  reset date, if one exists.
- The field that carries a provider request id.

Unknown prices stay unknown. Do not guess a price, an option that changes the price or a plan
allowance.

## 2. Start from the closer template

- `packages/providers/src/serpapi/`: monthly plans with an allowance, no cost per call, query
  parameter auth, account endpoint for the balance.
- `packages/providers/src/dataforseo/`: cost reported in every response, prepaid money balance,
  basic auth, deferred task results and a price list endpoint.

Create `descriptor.ts`, `extractors.ts`, `index.ts`, `fixtures/` and `<provider>.test.ts` in a
new `packages/providers/src/<provider>/` directory.

## 3. Descriptor (`descriptor.ts`)

Export a `ProviderDescriptor` from `@usagekit/core`:

- `id`, `label`, `upstream`, `auth`, `billing` (unit and cycle) and `docs` links.
- `plans` with exact allowances and `allowanceMode`; prepaid credits are a plan too.
- `prices`: exact decimal `PriceRow`s with `operation`, `plan` or `overage`, `unit`, `perUnit`,
  `source`, `validFrom` and `checkedAt`. Negotiated prices belong to a connection's
  `manualPrices`, not here.
- `operations`: a stable `id` (it is the pricing and budget key), `label`, `billable`, `match`
  rules (method and path), `costEvidence` and, when responses can be reused, `cacheable` key
  parameters.
- `balance` (the probe operation and JSON pointers), `priceList` and `billingExport` only where
  the API supports them; otherwise use the `none` or `static` kinds the templates use.

## 4. Extractors (`extractors.ts`)

Keep them synchronous and pure:

- `estimate`: usually `listEstimate` from `../prices.js`.
- `options`: read price-moving options from the request; return `{}` when none apply.
- `extract(operation, request, response, body)`: return a `ReceiptDraft` with measurements
  (include `requestsMeasured()`), the cost with its certainty (`measured`, `estimated` or
  `unknown`), `failed` for provider errors, and the provider request id when present. A failed
  call that the provider bills keeps its charge.
- `requestId`: read the id with `pointer(body, "/path")`.

Export `{ descriptor, extractors }` as a `ProviderModule` from `index.ts`.

## 5. Fixtures

Add `fixtures/<operation>/<case>.json` with `origin`, `provider`, `operation`, `request`,
`response` and `expect`. Use `documentation` or `synthetic` origins with the documentation
source, and `recorded` only for a real response the user approved and reviewed for personal
data. Write bigint values in `expect` as decimal strings. Every advertised operation needs a
fixture, plus the error cases that change cost.

## 6. Tests (`<provider>.test.ts`)

```ts
import { runDescriptorConformance } from "../testing/index.js";
const files = import.meta.glob("./fixtures/**/*.json", { eager: true, import: "default" });
runDescriptorConformance(provider.descriptor, provider.extractors, files);
```

Then test what the conformance harness cannot know: plan allowances and every price row,
estimates through `createCatalog`, billable failures, free operations, missing evidence,
request id extraction and, for deferred cost, the pending-to-corrected path.

## 7. Register and document

- Export the module from `packages/providers/src/index.ts`.
- Add it to the bundled list in `packages/server/src/index.ts` so the local server and proxy can
  match it.
- Add the provider to the bundled list in `docs/PROVIDERS.md` and wherever the docs and site
  name the bundled providers.

## 8. Verify

Run `npm run check` and `npm run build` with the pinned runtime. Both must pass without network
calls to the provider. Report which prices and plans came from which source and anything left
unknown.
