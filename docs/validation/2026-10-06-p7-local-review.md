# P7 local review: 2026-10-06

Reviewed implementation: `33faa0e`, on `feat/p7-cloudflare` in `.wt/p7-cloudflare`.
Local `main` is `844e99d` and is an ancestor of the task branch. The follow-up changes
update planning documents, improve smoke-test diagnostics and record this review;
Store and Worker implementation are unchanged.

## Scope

The P7 backend is authoritative SQLite-backed Durable Object storage, as permitted by the
plan's DO-ownership alternative. It is not a direct `D1Database` adapter. Each namespace routes
to one object so shared budgets have one admission authority.

Review covered synchronous transaction boundaries, exact amount columns, receipt and command
journals, budget versions, cursor snapshots, namespace routing, authentication and test fixture
isolation. Commands use `transactionSync`; SQL cursors are consumed before any await. These
boundaries follow the [Cloudflare SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Verification

Environment: Node 22.23.1, npm 10.9.3 and pinned Wrangler 4.141.0.

| Check                                                                          | Result                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                                                | PASS: runtime, workspace/privacy policy, formatting, TypeScript, unit tests, Git/release policy tests and both local Cloudflare checks.                                            |
| Unit tests                                                                     | 1203 passed, 8 explicitly skipped, 45 test files passed.                                                                                                                           |
| Cloudflare Store project                                                       | 179 passed, 1 skipped. The unchanged 175-case conformance suite advertises `durable: true`; only `rollingWindows` is skipped.                                                      |
| Repository script tests                                                        | 26 passed: 24 Git/release policy tests and 2 smoke-response regressions.                                                                                                           |
| Scaling gate                                                                   | After 5000 operations, command metrics remain 39 statements, 12 changed rows and 21 returned rows, matching the small database. Reads and cursor pages pass read-only enforcement. |
| `wrangler dev --local` example                                                 | PASS: authentication, scope isolation, reserve/replay/denial, dispatch, exact settlement, process restart and durable journal/projection.                                          |
| Remote harness exercised locally                                               | PASS: authentication, RPC, namespace validation, rollback immediately before commit and retry.                                                                                     |
| `npm run build`                                                                | PASS.                                                                                                                                                                              |
| `wrangler deploy --dry-run --config examples/cloudflare-worker/wrangler.jsonc` | PASS: Worker bundles with the SQLite Durable Object binding; no deployment.                                                                                                        |

The Cloudflare tests also cover two Worker entrypoints racing on one shared budget, a single
dispatch grant, transaction rollback, immutable budget versions and signed cursors after runtime
recreation. Exact cost `9007199254740993`, above JavaScript's safe integer range, survives the
shipped HTTP example and its process restart.

One validation attempt passed unit and policy tests, then stopped when local workerd returned
the non-JSON body `Error: Network connection lost.` during a scope-isolation request. A
standalone smoke rerun passed; the transport failure's cause was not isolated. The smoke now
reports the route, HTTP status, response text and recent Wrangler output instead of obscuring
that failure with a bare JSON parse error. Its regression test failed before the diagnostic
fix and passed afterwards. The smoke still fails on that response; no automatic retry or
relaxed assertion was added.

## Remaining boundaries

This review did not deploy resources, call providers, publish packages or modify a host ledger.
The [2026-09-27 cloud report](2026-09-27-p7-cloudflare.md) remains historical evidence; this local
run does not refresh its resources, network measurements or production capacity conclusions.
The optional private-terms file is absent in this worktree, so that name-list scan reports a
skip; the tracked-ADR and package-boundary guards still run.

P7 integration requires owner approval of the exact committed head and a proposed squash title,
through `npm run approve:main` as specified in the root README. Public hosting/CI remains an
open P4 item. P8 still needs current host/shadow evidence, ledger ownership per funding source,
retention and throughput decisions, real-database crash tests and a rehearsed rollback.
