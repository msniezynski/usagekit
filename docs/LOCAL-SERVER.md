# Local server

P2 supports one developer. It stores accounting in SQLite and provider keys in an encrypted vault.
It has no proxy, provider catalog, automatic evidence recovery, hosted service or UI yet.

## Install and start

From this checkout, use Node 22.23.1 and npm 10.9.3:

```sh
nvm use
npm ci
npm run build
export PATH="$PWD/node_modules/.bin:$PATH"
usagekit serve
```

The default address is `http://127.0.0.1:4242`. Override with `--port` or loopback `--host`.
Non-loopback binding is refused. `--allow-remote` reports unsupported TLS; it does not expose the service.
The default directory is `$XDG_CONFIG_HOME/usagekit`, or `~/.config/usagekit`.
Use `--config-dir <directory>` for another instance. Use the same directory after restart.
`config.json`, `usage.db`, SQLite side files and `vault.enc` have mode 0600.

The first start prints the local bearer token once. Save it outside shell history in a password manager.
Subsequent starts do not print it. The config stores only its SHA-256 hash.
Startup errors distinguish occupied ports, invalid config and failed vault unlock without printing sensitive details.
In a second terminal, read it without echo and export it:

```sh
read -rs USAGEKIT_TOKEN
export USAGEKIT_TOKEN
usagekit token show-path
usagekit usage --json
```

Set `USAGEKIT_URL`, or pass `--url`, when using another port.
`usagekit token rotate --json` returns a new token and immediately invalidates the old token.
Update `USAGEKIT_TOKEN` after rotation. There is no unauthenticated token recovery endpoint.

## Vault and provider connections

Interactive `serve` confirms a new hidden passphrase before creating the vault. Empty input leaves it locked.
Automation supplies `USAGEKIT_VAULT_PASSPHRASE` once, without confirmation. Keep it outside logs and shell history.
The vault uses scrypt and AES-256-GCM. OS keychain integration remains a follow-up.
A locked vault permits accounting and connection listing. It refuses key changes and provider tests.
Restart with the passphrase to unlock. Keep a secure passphrase backup; there is no recovery key.

```sh
read -rs PROVIDER_KEY
export PROVIDER_KEY
usagekit provider add serpapi --connection c1 --secret-env PROVIDER_KEY
unset PROVIDER_KEY
usagekit provider list
usagekit provider test --connection c1
```

Alternatively, pipe the secret into `provider add`; do not pass it as an argument.
Provider tests validate format only. `network: false` means no provider authentication or balance was checked.
`usagekit provider remove --connection c1` removes the stored key, preserving accounting history.
Secret plaintext is absent from responses, logs, SQLite, config and encrypted vault bytes.
An existing connection ID cannot silently change provider; same-provider key rotation remains supported.

## Budget and cooperating scripts

```sh
usagekit budget set --id monthly --limit 10:requests
usagekit budget list
operation=$(usagekit report reserve --provider serpapi --connection c1 \
  --estimate 1:requests --command-id job-001) || exit $?
# Call the provider only after this command exits 0. Never repeat it on an accounting retry.
usagekit report settle --operation "$operation" --quantity 1:requests \
  --cost 0.0100 --command-id job-001-settle
usagekit usage --window month --group provider,day --unit requests
```

`--cost` is cents, with at most four decimal places; `0.0100` is 100 internal money units.
Quantities accept `amount:unit`; comma-separated estimates cover multiple bounded units.
Reserve returns an operation ID only after obtaining the first dispatch grant.
A replay refuses dispatch and exits 1, even when it finds an existing reserved operation.
The default lease is 60 seconds. `--lease-ms` sets another duration; SDK callers can renew long calls.
`report release --operation <id>` applies only to reservations without dispatch intent, such as SDK-created reservations.
Expired or uncertain dispatched work requires recovery evidence, never release or a repeated provider call.

Pass a stable `--command-id` on retries. Without one, commands generate new UUIDs.
Settle and release save exact request bodies under `<config-dir>/requests/`, mode 0600, before sending.
Keep these files for retries: they preserve receipt timestamps and expected versions across CLI restarts.
A changed payload under the same command ID is a usage error. Request files contain no authentication secrets.
`--occurred-at` supplies the actual UTC event time; otherwise settlement uses the current time.
Every command accepts `--json`. Monetary and quantity integers become decimal strings.
Exit codes: 0 success; 1 denied, exceeded or replayed dispatch; 2 usage error; 3 remote unavailable.
An exceeded result includes `resetsAt`. On transport failure inspect or replay accounting; never repeat the provider call blindly.

Budget scopes: `principal` (default local), `connection`, `group`, `access_credential`, `platform_pool`.
Use `--scope` with `--connection`, `--group`, `--credential-kind`/`--credential-id`, or `--pool`.
Budget windows: `month`; `cycle --epoch <id> --from <UTC> --to <UTC>`; `reset --epoch <id> --from <UTC>`.
`budget set` creates the next version. `--warn` warns instead of blocking; `--unlimited --unit requests` removes a bound.
Usage accepts `--window cycle|reset`, using matching budget windows. Select `--id` when windows differ.
Use `--cursor` from the previous JSON usage page; cursor snapshots expire after five minutes.

## Restart and enforcement boundary

SQLite uses WAL, FULL synchronization and one IMMEDIATE transaction per command.
Restart preserves operations, receipts, command replays, reservations and expired leases.
A new worker claims expired work through `Meter.claimForRecovery`, then settles from provider evidence.
Recovery never grants dispatch again. No provider evidence worker runs automatically in P2.
Only undispatched reservations expire: five minutes by default, with an SDK override from 1 ms to one day.
Dispatch after the reservation deadline atomically releases the hold and fails. Replay never extends the deadline or grants another call.
Startup and thirty-second sweeps release overdue `reserved` operations. Admission cleans at most one default batch.
`usagekit report expire --json` runs one maintenance batch; repeat while `hasMore` is true.
Dispatch-intended work never expires into release, even when its dispatch lease expires.
SQLite commands update one operation and its budget counters. Reads use read-only transactions and signed snapshot cursors.
Upgrading a pre-event database invalidates old cursors; restart those usage queries.
The local token is a fully trusted owner credential. Multi-user write permissions require a separate host policy.
Calls bypassing this API remain unmetered. P2 blocks cooperating scripts; routed provider blocking follows in P4.
