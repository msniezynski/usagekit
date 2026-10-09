# Provider UI and headless hooks

Provider administration is a host capability. The Meter owns accounting reads; it does not
store provider credentials, configure OAuth, route connections or own customer wallets.
The React layer composes both capabilities without introducing another balance authority.

`@usagekit/views` exports provider DTOs and the `ProviderManagementPort` contract.
`@usagekit/react` consumes that port without styling. Registry blocks render the same
models with Radix or Base UI primitives in each shadcn style. `@usagekit/views` and
`@usagekit/react` are published at 0.7.0; registry and site workspaces remain private.
See [consuming packages](CONSUMING.md) for published packages and reviewed checkout candidates.

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

## Provider editors

`useProviderEditor(query, options?)` is new in the 0.7.0 React package and absent from the
published 0.6.0 package. It accepts the provider context or the same standalone binding options
as the read hooks.

The editor separates two snapshots:

- `editorData` is the immutable initializer for a draft. Details and allocation editors use
  its expected revisions. Background reads never replace it. `editorEpoch` identifies a
  draft identity change or explicit rebase.
- `evidence` is the current read snapshot for non-draft figures, balances, availability
  and rate provenance. Never present retained `editorData` as current financial evidence.

A background refresh in the same binding may retain valid evidence, but `canEdit` and
`action.run` stay fenced until the read finishes. A failed or forbidden read removes
evidence while preserving a disabled draft. An execute-forbidden result also hides evidence
and fences edits until a successful explicit reload; a conflict retains the draft and fences
further writes while independently valid evidence may remain visible. Background recovery
after a read failure can restore evidence, but cannot silently replace the draft base or clear
an action denial or conflict fence.

`reload()` explicitly requests a fresh draft base. Only a successful reload rebases the
form and clears an action denial or conflict fence; it may discard unsaved draft changes.
A failed reload preserves the draft, and a later background read cannot complete that failed
reload. Scope, principal, authorization revision, port, query or query-client changes isolate
the editor immediately. Late reads and callbacks from the old identity cannot restore it.

The existing command journal remains authoritative. Reload is unavailable while a command
is pending or ambiguous, and cannot erase the original submitted command or bypass its
write fence. Remounting the same query preserves its exact submitted values as pending or
ambiguous command state; another query cannot use them to initialize its draft.
`action.reconcile` checks that command's status without retrying it; it does not require
displayed financial evidence, but the host must independently authorize the request.

A connections list can open a new selected editor from current evidence after a background
refresh or an explicit connection action. That selected form owns a stable draft and CAS base;
it does not inherit the list's initial revision. The hook checks the current target and command
capability, while the host independently enforces the submitted CAS revision. Existing dirty
forms still require a successful explicit reload to adopt a different base.

Hook-backed editor panels enforce this lifecycle. Pure leaf components render explicit
props; a host composing those leaves owns draft identity, current evidence and write fencing.
For a details editor, a minimal host composition looks like this:

```tsx
import { useProviderEditor } from "@usagekit/react";
import { HostRateForm } from "./host-rate-form";

function Rates({ connectionId }: { connectionId: string }) {
  const editor = useProviderEditor({ kind: "details", connectionId });
  return (
    <>
      <button
        type="button"
        onClick={editor.reload}
        disabled={editor.refreshing || editor.action.pending || editor.action.ambiguous}
      >
        Reload rates
      </button>
      {editor.editorData?.connection && (
        <HostRateForm
          key={editor.editorEpoch}
          base={editor.editorData.connection}
          evidence={editor.evidence?.connection ?? null}
          action={editor.action}
          disabled={!editor.canEdit}
        />
      )}
    </>
  );
}
```

`HostRateForm` is host UI: initialize exact draft strings from `base`, display non-draft
figures only from `evidence`, honor `disabled` and current per-command capabilities, and
submit through `action.run`. Render the hook's read state and error alongside the form.
The copyable `ProviderRatePanel` supplies this read feedback and composition already.

## Rates

A `ProviderRate` prices one `unit`, named in the singular ("request", "keyword"), in its
native `priceUnit`. Usagekit money is USD cents, so the rate editor shows a `cents` price
as exact dollars ("$0.00625") and takes dollars with at most six decimal places, converting
them to cents without floating point. Other price units are shown and entered as they are.

`provenance` says where the current price comes from: a manual price, a measured rate, a
list price or nothing yet. For a manual price, the host may add `fallback`: the price and
provenance that apply once the manual price is cleared; `fallback` is new in the 0.8.0 views
package. The editor then names the reset
after it ("Use measured rate", "Use list price") and shows it as "Without your rate". Without
`fallback` the reset reads "Clear your rate". Only a manual rate offers a reset.

Each rate is a collapsed row with its price per unit and source. Opening it shows when the
rate was checked, its samples and version where known, the operation and funding source,
and the form.

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

Host applications and the Usagekit dashboard are the intended consumers of the same React hooks
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

The website's example host integration shows an existing metering integration. Adoption of these
new React blocks there is still pending. Its application adapter keeps OAuth, credential storage,
funding permissions and wallet ownership in the application while projecting neutral DTOs
into the shared UI. Both integrations should exercise the same read-only, exact-value,
conflict and unknown-result cases before replacing their current screens.
