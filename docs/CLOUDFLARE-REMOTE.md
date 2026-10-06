# Cloudflare remote integration tests

This opt-in fixture deploys real Workers and SQLite-backed Durable Objects. It uses only
synthetic accounting data. It does not call providers, touch a host database, promote main,
or publish npm packages. The first verified run is recorded in
[the P7 cloud report](validation/2026-09-27-p7-cloudflare.md).

## Prepare and execute

Use the repository's pinned Node and Wrangler. Select an account explicitly after checking
`npx wrangler whoami`. Before a first deployment, obtain authorization for that account and
these isolated test resources.

```sh
npm ci
npm run typecheck
npm run test:cloudflare:remote:local
export CLOUDFLARE_ACCOUNT_ID='<selected account id>'
node examples/cloudflare-worker/remote/deploy.mjs prepare
node examples/cloudflare-worker/remote/deploy.mjs dry-run
node examples/cloudflare-worker/remote/deploy.mjs deploy
node examples/cloudflare-worker/remote/exercise.mjs before
node examples/cloudflare-worker/remote/deploy.mjs redeploy
node examples/cloudflare-worker/remote/exercise.mjs after
```

`prepare` creates unique Worker names, three concrete Wrangler configurations, a deployment
manifest and a random token in the ignored `examples/cloudflare-worker/remote/.state/` directory.
The directory is mode 0700 and the secret file is mode 0600. The token never appears in command
arguments or output. Deployment uses Wrangler's `--secrets-file`. Keep this directory local;
it is needed to rerun tests against the same resources. Do not copy its secret into reports.
The script verifies account membership and refuses to overwrite an existing Worker unless
its version is already recorded as owned by this fixture.

The owner Worker exposes two classes: the unchanged example `UsageLedger` and a separate
`RemoteLedger` fixture. It has no workers.dev or preview URL. Two authenticated gateways bind
to both classes on that owner. `/v1/*` exercises the original example's validated HTTP contract.
`/test` calls the fixture through Durable Object RPC, with a bounded body and explicit method
allowlist. The fixture validates namespace/object identity and offers a controlled clock and
failure immediately before transaction commit. These testing controls are absent from the
ordinary example and its deployment configuration.

Run identifiers isolate scenarios into separate Durable Objects. Every shared-pool race sends
both principals through the same object. The driver retries transport failures at most twice
with the same serialized command and records every failure; it never generates a replacement
operation ID for a retry. HTTP/application failures are not silently retried. Reports include
latencies measured from the operator machine, request counts, edge locations from CF-Ray,
version IDs and instance IDs around redeployment. They are not server-only latency metrics.

`after` waits for the expected runtime revision, rather than assuming Wrangler completion
means every object has already switched. Cloudflare distributes code updates with eventual
consistency; see [the Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/#code-updates).
It then requires a changed instance ID and verifies durable state, replay, recovery and cursors.

## Resource ownership and next events

Only `remote/deploy.mjs` owns these resources. They have no GitHub workflow, scheduled cleanup,
production routes, service consumers outside this fixture, or automatic deployment on commit.

- `prepare` reuses the local manifest and token. It never changes an account resource.
- `deploy` updates the owner first, then both gateways; class and namespace bindings stay stable.
- `redeploy` updates only the owner, changes its revision marker, and preserves storage and token.
- A code rollback must preserve both classes and the schema. Code rollback does not roll back data.
- Secret rotation requires updating the local protected secret and redeploying all three Workers.
  Reusing `deploy` applies that secret to each Worker; gateways and owner must agree.
- Changing migration/class names or routing can orphan stored state. Do not rename them during a test.
- The fixture remains available for inspection after a run; nothing cleans it up automatically.
  If it is later retired, use the manifest's exact names, remove the two gateways before the owner,
  and verify that no other Worker binds to its classes. Deleting the owner may require deleting
  its Durable Object classes and permanently removes test data; keep the report first.

`npm run check` generates and checks fixture types and tests the harness locally. It never
runs `deploy.mjs` or `exercise.mjs`, so ordinary validation cannot create cloud resources.
