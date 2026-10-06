# P7 on Cloudflare: 2026-09-27

Status: **12 scenario groups passed on deployed Cloudflare Workers**, completed at
`2026-09-27T19:00:41.173Z`. Store source is the P7 implementation at `381914434ec5258ca54de4e3d3eeaf5207862b0e`.
The committed `examples/cloudflare-worker/remote/` harness provides the reproduction steps.
No Store implementation changes were required by this cloud run.

## Environment

Account: `contact@webscraping.app` (`20c17ce4aba68ebbfd7028c76dfb8458`).
Wrangler: 4.141.0; compatibility date: 2026-09-27.
Authoritative storage: SQLite-backed Durable Objects. Direct D1Database was not tested.
The owner has no public URL. Gateways require a random bearer token, stored locally in the
ignored fixture state directory and uploaded as a Worker secret.

| Role  | Worker                              | Final version                          |
| ----- | ----------------------------------- | -------------------------------------- |
| owner | `usagekit-p7-owner-20260927-ef0ee0` | `a7a60ca7-420b-4443-a9be-7c4979c40e13` |
| a     | `usagekit-p7-a-20260927-ef0ee0`     | `6d2e1a44-0b87-4976-ba34-f9991a9eb9ac` |
| b     | `usagekit-p7-b-20260927-ef0ee0`     | `04ac6088-2eb8-4263-930e-be73ab5254dc` |

- [Gateway A](https://usagekit-p7-a-20260927-ef0ee0.3i-atlas.workers.dev)
- [Gateway B](https://usagekit-p7-b-20260927-ef0ee0.3i-atlas.workers.dev)

An unauthenticated request returns 401. The environment remains deployed for inspection.
The initial owner version was `cd44abe5-7b6d-484e-b7ef-ccca9afc3efd`.
Cloudflare's deployment history recorded the replacement at 100% traffic; runtime evidence
confirmed the new revision and a different object instance, then reread persistent data.

## Results

| Scenario                                                                                               | Result |
| ------------------------------------------------------------------------------------------------------ | ------ |
| Both deployed gateways authenticate and reject cross-namespace input                                   | PASS   |
| Two deployed Workers: 20 shared-pool races, exactly one admission and dispatch each                    | PASS   |
| 100 concurrent requests respect a shared limit of 25                                                   | PASS   |
| Failure after all writes rolls back journal, event, receipt and projection; retry settles exactly once | PASS   |
| Concurrent budget version update has one winner                                                        | PASS   |
| Expiry releases only undispatched reservations                                                         | PASS   |
| Persisted cursor checkpoint prepared                                                                   | PASS   |
| Unchanged shipped HTTP example works remotely through both gateways                                    | PASS   |
| Redeploy reconstructed the object; exact amount, journal, budget version and usage survived            | PASS   |
| Signed cursor survives redeploy and rejects tampering                                                  | PASS   |
| Recovery after redeploy settles old dispatch without a second dispatch grant                           | PASS   |
| Unchanged HTTP example data survives redeploy                                                          | PASS   |

The race test used 20 fresh shared-pool budgets, each capped at one request. Two separate
Worker entrypoints submitted different principals concurrently. Each round admitted exactly
one operation, issued one dispatch grant, and accounted for one unit after concurrent
settlement/replay. The burst test issued 100 concurrent HTTP requests against one budget of 25:
25 operations were reserved and 75 denied. Persisted outstanding use was exactly 25.

The rollback injection runs after every SQL write in the command, immediately before commit.
After the failed settlement, the operation remained dispatched, its receipt was absent,
the settled event was absent, and budget figures matched their previous values. The identical
settlement then succeeded once and replayed without duplication. The exact cost
`9007199254740993` survived storage, HTTP and redeployment.

## Network and timing observations

The first attempt stopped on an `ECONNRESET` during the 100-request burst. It is not counted as
a complete pass. The completed run used bounded retries of the same serialized command and
recorded **16 transport failures**. These retries produced no extra reservations
or settlements. There were 316 completed HTTP exchanges in the recorded run, including
control/read calls and redeployment probes; this is not the total across earlier attempts.

Latency includes the operator machine, network, client scheduling and retries:

| Metric  | Milliseconds |
| ------- | -----------: |
| p50     |        72.43 |
| p95     |      6850.55 |
| maximum |     10828.87 |

The 100-request burst completed in 10878 ms. CF-Ray locations observed: `WAW` only.
The test establishes accounting correctness under this burst; these measurements do not
establish production throughput or isolate the reason for slow requests/connection resets.
A server-timed load test from another origin is needed for capacity conclusions.

The first read immediately after redeploy still returned the previous runtime revision.
A later probe saw the new revision and instance. The driver now waits for that evidence before
checking persistence. This matches Cloudflare's documented
[eventual propagation of code updates](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/#code-updates).

## Boundaries

No real provider calls, customer data, host credit ledger, regional outage, server crash, or
long-duration soak test were involved. A real code redeployment/reconstruction was tested.
The fixture uses a controlled clock for expiry and recovery; the unchanged HTTP example uses
the actual runtime clock. Production authority cutover and host crash coordination remain P8.

Full checks and local reproduction: `npm run check`, `npm run test:cloudflare:remote:local`,
then the explicit remote sequence in [CLOUDFLARE-REMOTE.md](../CLOUDFLARE-REMOTE.md).
