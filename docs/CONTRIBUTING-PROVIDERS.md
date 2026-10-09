# Contributing a provider

A provider contribution consists of descriptor data, pure extractors, redacted fixtures and
contract tests. Coding agents can follow the
[add-provider skill](../.claude/skills/add-provider/SKILL.md), which walks through these steps.
A new descriptor works in a checkout right away; once contributed, it ships with the next
`@usagekit/providers` release.

1. Add `src/<provider>/descriptor.ts` and `extractors.ts`, following the two bundled providers.
   Give every operation a stable id, method/path match, billable flag and cost evidence kind.
   Keep free account and retrieval operations explicit. Do not put credentials in descriptors.
2. Add plans and exact decimal price rows with source URLs, `validFrom` and `checkedAt`.
   Unknown prices stay unknown. Negotiated prices belong to a host connection's `manualPrices`.
   Measured prices need a sample count; the default minimum is five. Distinguish plan allowance
   from per-call money and overage. Mark unverified assumptions in the provider documentation.
3. Export a `ProviderModule` from `index.ts`. Implement synchronous extraction, request id and
   options; add balance, price-list or billing-export parsers only where evidence supports them.
4. Add fixtures in `src/<provider>/fixtures/<operation>/<case>.json`. Each contains `origin`,
   `provider`, `operation`, `request`, `response` and `expect`. Expectations encode bigint values
   as decimal strings. Use `documentation`, `synthetic` or `recorded` truthfully; include the
   documentation source. Each advertised operation must have a fixture and parsed expectation.
5. Call `runDescriptorConformance` from `@usagekit/providers/testing` with the descriptor,
   extractors and `import.meta.glob("./fixtures/**/*.json", { eager: true, import: "default" })`.
   Test success, billable failures, missing evidence, free operations and request-id extraction.
   Test plan budgets and all pricing options. Deferred cost needs a pending-to-corrected test.
6. Run `npm run check` and `npm run build` with the pinned runtime. No paid test calls are needed.

## Recording fixtures locally

Unlock the local server vault and add a connection with its plan. Put a request object in a
local JSON file, for example `{ "method": "GET", "url": "/search.json?q=example" }`, then run:

```sh
usagekit provider record --connection search --feature search --request request.json --json
```

This explicitly performs **one real provider call** and can incur a charge. The server matches
it against an enabled descriptor, injects the vault key, applies the connection's tracking
policy and reserves before dispatch. It never retries or follows redirects. Requests and
responses are capped at 2 MiB and transport is limited to 30 seconds. A failed or incomplete
transport keeps possible charges pending. Free and passthrough operations are counted only.
Repeated CLI invocations are distinct paid attempts, not accounting replays.

The private fixture is saved below `<config-dir>/fixtures/<provider>/<operation>/`. The server
removes credentials, common secret fields and account identity; inspect the entire file for
other personal or proprietary content before sharing. Only safe request headers are sent.
The file starts with `expect: {}`: add independently checked expectations before contributing;
the conformance harness intentionally rejects a fixture without expectations.

## Enforcing the wrapper boundary

The `@usagekit/providers/eslint` export provides `usagekit/no-direct-provider-call`:

```js
import usagekit from "@usagekit/providers/eslint";
export default [
  {
    plugins: { usagekit },
    rules: {
      "usagekit/no-direct-provider-call": [
        "error",
        {
          modules: ["provider-sdk", "@vendor/**", "@/lib/provider-client"],
          wrappers: ["src/metering/*.ts"],
        },
      ],
    },
  },
];
```

Use ESLint 9 or 10 and the host's TypeScript parser for TS files. Patterns are case-sensitive:
`*` matches one path segment; `**` matches any depth. Wrapper paths are relative to ESLint's
working directory. Cover every import alias of a protected client. The rule catches imports,
re-exports, literal dynamic imports and literal `require` calls. It does not prove the absence
of direct `fetch`, computed imports or unlisted aliases; review those in the host's inventory.

The wrapper owns reserve, dispatch grant, extraction and settlement. Only a new dispatch grant
allows a metered provider call. An accounting replay must never issue the provider request again.
