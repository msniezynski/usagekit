# Local proxy (P6)

The local server routes authenticated requests through `@usagekit/proxy`. The package is
private, as are the server and CLI. The repository records the four public library packages
at 0.4.0; this branch prepares their 0.5.0 candidate. See the [migration guide](MIGRATING-0.5.md).
Start from this checkout using the root README. Nothing needs to change in a production host.

```sh
usagekit serve --providers dataforseo,serpapi
# Optionally reject every path not advertised by the enabled descriptors:
usagekit serve --providers serpapi --strict-proxy
```

The default provider allowlist is the two bundled providers. `--providers ''` disables all
provider dispatch. These options apply when starting the process; restart with the desired
options to change them. The vault must be unlocked using the existing passphrase flow.
Server code can use `enabledProviders` and `strictProxy` in `startServer`.

## Requests and credentials

Use `/proxy/<connection-id>/<upstream-path>` with the local server's bearer token. The
connection selects the provider. For DataForSEO include `/v3` in the upstream path.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $USAGEKIT_TOKEN" \
  -H 'Idempotency-Key: search-job-001' \
  'http://127.0.0.1:4242/proxy/c1/search.json?q=example&engine=google'
```

The server fixes `namespace=local`, `principal=local`, `source=proxy`,
`surface=programmatic`, `fundingSource=byok` and snapshots connection tags. Headers and query
fields cannot choose billing ownership. Only Accept and Content-Type are forwarded from the
client. Client credentials, cookies and authentication query parameters are removed, then
credentials are injected from the vault according to the descriptor. The destination origin
is pinned to the enabled descriptor; caller paths cannot set a host and redirects are not
followed. Response cookies, redirects and hop-by-hop headers are not forwarded.

JSON bodies are parsed for price options and forwarded with their original bytes. Request
bodies are limited to 2 MiB. Invalid JSON with a JSON content type is rejected before admission.
GET, HEAD, POST, PUT, PATCH and DELETE are supported. Provider business failures preserve their
HTTP status and body; a billed failure still receives a receipt.

## Budgets, unknown paths and passthrough

Reservation uses the same catalog and connection pricing as the embedded Meter. Blocking
budgets deny before dispatch with **429**, `allowance_exceeded` and `Retry-After`. The delay
is the budget reset time rounded up; a budget without an automatic reset returns 60 seconds
as a recheck interval, not a promise that it will admit then. Allow budgets retain their normal
warning and hard-limit semantics. Estimated prices cannot guarantee an exact monetary ceiling
when a provider bills more than the estimate; actual overruns remain in the ledger.

Unknown paths pass by default only if admission permits a one-request reservation. They have
operation `unknown`, unknown cost, pending evidence and unpriced coverage. Monetary/native-unit
bounds with no defensible estimate fail closed with **422**. `--strict-proxy` counts the path
as unpriced and returns **404** without dispatch. Known free operations and connection policies
set to `passthrough` forward without a reservation; the durable passthrough counter records
them. A passthrough choice intentionally opts that operation out of spend enforcement.

Every forwarded response carries `X-Usagekit-Operation-Id` and `X-Usagekit-Accounting`:
`metered`, `unpriced` or `passthrough`. Unknown operations appear on the existing exceptions
page; no request content is stored in the accounting ledger.

## Idempotency and errors

An `Idempotency-Key` is the operation ID. It must contain 1–128 ASCII letters, digits, `.`,
`_`, `:` or `-`. Without it each request gets a fresh UUID, even if its body is identical.
A repeated admitted ID returns **409**; it never returns cached provider content or dispatches
again. The same fence holds for concurrent requests, restarts, key rotation and switching a
connection between metered and passthrough modes. Use a new ID for an intentional paid retry.
The ledger stores operation semantics, not request bodies or their hashes, so a replay does
not claim that the caller supplied an identical body. A budget denial consumes no ID.

Other local errors: **401** invalid server token, **403** disabled provider, **404** missing
connection, **423** locked vault, **400** malformed input, **405** unsupported method,
**413** oversized body, **422** unestimable bounded usage, **502** failed provider transport,
**503** accounting awaiting recovery. Errors contain safe categories, never transport messages
or credentials. Once response streaming begins, a later error interrupts the stream instead
of pretending it can replace the already-sent HTTP status.

## Streaming, shutdown and recovery

Response chunks pass through with backpressure. Only the first 2 MiB are buffered for receipt
extraction; crossing that bound discards the capture and preserves unknown cost while still
forwarding the body. Accounting settles only after upstream EOF. Interrupted streams, client
cancellation and failed transport retain uncertain exposure. The outbound request has a
30-second deadline and a 60-second dispatch lease. No transport is retried automatically.

The server owns startup and 30-second maintenance. Undispatched reservations expire using the
existing cleanup. Expired proxy dispatch intents are fenced with a recovery lease and become
pending with unknown measurements/cost. Recovery never calls providers or releases possible
charges. Active leases remain untouched, and pending evidence is not repeatedly rewritten.
Normal shutdown closes the HTTP server before closing SQLite and locking the vault. SIGKILL
is covered by durable dispatch intent and startup recovery; lost evidence requires later
verified settlement/correction, never an automatic resend. Existing reporting/embedded
operations are not claimed by the proxy recovery worker.

## Explicit fixture recording

Add `X-Usagekit-Record-Fixture: true` to the **next intended call** to save a redacted fixture
from that same response. No second provider request is made. This also works on unknown paths.
Files are written under `<config-dir>/fixtures/<provider>/<operation>/<random-id>.json`, mode
0600, after stream completion. Known secrets, authentication fields and email identities are
redacted. Review the file before sharing: recording is explicit consent to retain request and
response content outside the accounting ledger. Unknown fixtures need a descriptor operation
and extractor assertions before they can become advertised catalog coverage.

A failed/incomplete or oversized recording does not claim a complete fixture. For an oversized
response the client stream fails at completion after the accounting result is retained. The
`X-Usagekit-Fixture-Recording: requested` header acknowledges the request, not successful save.

## Verification map

| P6 requirement                                               | Evidence                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Authentication, allowlist, key injection, pinned destination | HTTP tests in `packages/server/src/proxy.test.ts`                                        |
| Actual denied dispatch and Retry-After                       | Zero-cap HTTP test asserts 429 and zero transport calls                                  |
| Unknown default/strict policy and budget safety              | Unknown-path, unestimable-bound and strict tests                                         |
| Passthrough with no reservation and durable counts           | Policy-switch and free-call test                                                         |
| No duplicate billing on replay                               | Twelve concurrent requests, one dispatch; restart and policy-switch tests                |
| Receipt only after stream close; uncertain broken stream     | Controlled-stream and oversized-response tests                                           |
| Restart recovery without redispatch                          | SIGKILL of a real server during a routed request; restarted ledger and replay assertions |
| Exceptions, unpriced coverage, no double counting            | Proxy → HTTP Meter → view-model integration test                                         |
| Explicit recording with no extra charge                      | Unknown-path recording test, redaction and file-mode assertions                          |

P5 descriptor fixtures and host compatibility proofs remain in the existing provider tests and
`docs/PROVIDER-HOST-COMPATIBILITY.md`. P8 is the separate production authority cutover.
