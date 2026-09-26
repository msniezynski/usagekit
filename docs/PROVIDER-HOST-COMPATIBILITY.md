# Provider catalog host compatibility

Read-only inventory checked on 2026-09-26 against host A's existing provider clients.
`packages/providers/src/host-compat.test.ts` freezes 19 public method/URL pairs and checks
descriptor identity, free/paid classification and input immutability. It covers live SERP,
queued post/ready/get, eight Labs calls, three backlink calls, account/status probes and
SerpApi search/account. Task ids are placeholders. No host source or credentials are copied.

This is a contract compatibility check. It does not install the catalog in a host or prove a
production rollout. Host-specific admission, customer charges, retries, reconciliation and
existing ledger authority remain owned by the host. Keep its explicit/manual prices during
initial adoption, compare extracted receipts in shadow, and separately review runtime wiring.
A descriptor's default list estimate must not silently replace a negotiated host price.

The local reference server exercises the complete catalog path over HTTP and the CLI. Host
publication, package installation and rollout remain separate approval steps from local P5.

## Host mapping proof

The host's `feat/provider-catalog-mapping` branch adds an injected `ProviderCatalogPort` and
`catalogReservation`, `catalogOperation`, and `catalogPlans`. It imports the host's actual plan
and rate definitions. It maps 14 paid operation variants and the five current host plans.
Composite keyword research and queued/live rank checks require an explicit variant; disabled
providers and unsupported features return no mapping.

The host smoke command uses `USAGEKIT_PROVIDERS_MODULE` pointing to the built providers module
and runs `scripts/smoke/provider-catalog.ts` through its TypeScript loader. It checks four depths
with list and custom prices and verifies that scope, funding, quantities and price inputs are
copied unchanged. The adapter is additive: it neither replaces existing provider transports
nor switches ledger authority. That production wiring belongs to the subsequent host rollout.
