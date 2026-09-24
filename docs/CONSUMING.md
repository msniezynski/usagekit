# Consuming usagekit

Use Node 22 and pin exact package versions:

```sh
npm install --save-exact @usagekit/core@0.1.0 @usagekit/store@0.1.0 @usagekit/meter@0.1.0
```

The registry is `https://registry.npmjs.org/`. No scope registry mapping is needed.
The packages are public. No registry token is required to install them.
Consumers that configured a read-only token during the private phase should verify a token-free `npm ci` and then remove the token from CI, deployment and user configuration.

## Embedded contract

Create an in-process Meter with a host Store, policy and injected clock.
Authorize writes in the host. Build read AccessContext from verified server credentials.
Reserve before dispatch. Only a first dispatch grant allows a provider call.
Reservation lifetime defaults to five minutes and has a maximum of one day.
Queue producers must obtain intent at enqueue and carry the lease, or cover queue delay in the lifetime.
An expired reservation cannot dispatch and is atomically released when intent is attempted.
Schedule expireReservations for each namespace; repeat batches while hasMore is true.
Admission cleans only one default batch. Embedded consumers own remaining maintenance.
The local server schedules cleanup every thirty seconds.
Expired dispatch leases require evidence recovery; never redispatch or release uncertain exposure.
Reconcile external credit holds through their authoritative ledger.

## Adapter conformance

Runtime imports use @usagekit/store. The reference implementation is also exported at /reference.
Import runStoreConformance and runStoreScalingConformance from @usagekit/store/conformance.
The conformance entry ships compiled JavaScript and declarations, not TypeScript sources or test runners.
Consumers running it provide compatible vitest 5 and fast-check 4 peers as development dependencies.
Every case uses the supplied factory. Durable adapters must implement the restart fixture.
Skipped capabilities are not passed guarantees.

## Release operators

Only npm run release can publish core, store and meter. Other workspaces stay private.
Live release requires clean main, its verified signed v0.1.0 tag, full checks and inspected tarballs.
A dry run on a clean branch builds and audits packages without checking live authorization or publishing.
Apache-2.0 LICENSE and NOTICE are included in every tarball.
