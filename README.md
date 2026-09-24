# usagekit

Local metering for provider usage and costs, with required admin views of usage,
costs and application credits. Both BYOK and platform-funded keys are in scope.
Host A uses Postgres and Prisma. Host B adds team-owned connections.
Host C targets Cloudflare D1. A local server shares the embedded Meter contract.

**Status: P1 and P2 approved on main. P3 packaging and host integration are in progress.**
Licensed under Apache-2.0. Core, Store and Meter target `@usagekit` on registry.npmjs.org at version 0.1.0.
`core`, `store` and `meter` are published publicly on npm. Other workspaces remain private. See [consuming packages](docs/CONSUMING.md) and the [roadmap](docs/ROADMAP.md).

## Start here

Use Node **22.23.1** from `.nvmrc` and npm **10.9.3** as the baseline.
Supported ranges are Node `>=22.23.1 <23` and npm `>=10.9.3 <11`.
The lockfile pins dependencies. `@types/node` is pinned to the Node 22 line.

```sh
nvm use
npm ci
npm run check
npm run build
export PATH="$PWD/node_modules/.bin:$PATH"
usagekit serve
```

See [local server operation](docs/LOCAL-SERVER.md) for tokens, the vault, budgets, scripts and restart recovery.

`npm ci` installs local hooks through `prepare`. Use `npm run setup` if scripts were disabled.
Hooks prefer the pinned NVM binary. Otherwise PATH must satisfy the supported range.

| Command             | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `npm run check`     | Runtime, workspace/privacy checks, formatting, TypeScript, unit and policy tests |
| `npm run format`    | Format source and documentation, excluding local ADRs                            |
| `npm run typecheck` | Check references and emit declarations into ignored `dist/`                      |
| `npm run build`     | Build the eight existing workspaces                                              |
| `npm test`          | Policy tests in disposable local repositories                                    |
| `npm run setup`     | Install repository-local hooks and Git defaults                                  |

## Working agreement

This README is the single source of workflow rules. Keep one root README.
`AGENTS.md` points agents here. Do not create competing package instructions.

1. Work on task branches such as `feat/meter-contract`. Never develop on `main` or detached HEAD.
2. Preserve unrelated work. Use dedicated worktrees for concurrent tasks; `.wt/` is ignored.
   Bootstrap stays on `chore/bootstrap-workspace` for review.
3. Use Conventional Commits. Do not add `Co-Authored-By` or tool/AI attribution to commits, descriptions or review text.
4. Run `npm run check` before handoff. Review the staged diff before committing.
5. Integrate only by squash through `npm run approve:main`. Rebase task branches; never create merge commits.
   Main contains stable, reviewed, explicitly owner-approved versions only.
6. Passing checks or implementing work does not authorize promotion, push, publication, deployment or release.
   Agents must never supply owner approval themselves.
7. Publication of core, store and meter runs only through `npm run release`; the packages are public.
   Public access follows the P3 exit gate. GitHub hosting still requires an explicit repository target.
   Do not publish other workspaces or deploy services without separate authorization.
8. Never bypass hooks. Fix the cause of a failure. Local guards are not a tamper-proof security boundary.

The approved bootstrap is on local `main`. New work stays on task branches for review.
For an initial bootstrap commit, the workflow is:

```sh
git add .
git commit -m "chore(repo): scaffold local workspace"
```

Only after separate approval of the exact committed version:

```sh
git rev-parse HEAD
npm run approve:main -- --approved-sha <full-reviewed-head-sha> --subject "feat: describe the approved result"
```

Promotion requires a clean task branch, active hooks and passing full checks.
Present the proposed squash title when requesting owner approval. `--subject` accepts one Conventional Commit title.
It creates one squash commit with the reviewed tree and previous main as its sole parent.
The first approval creates a root commit. The current task branch stays checked out.
Rebase and obtain new approval if main advances. Nothing is pushed by promotion.
Expired local approval markers are removed. Active markers report their path and remaining lifetime.

The command cannot verify human intent. `--approved-sha` asserts prior owner approval.
Future hosting requires separate authorization and server-side branch protection.
No-remote and no-push rules are owner instructions, not technical hook restrictions.

## Git hooks

Hooks live in `.githooks/`, installed as local `core.hooksPath`.

| Hook                    | Behavior                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `pre-commit`            | Requires a task branch and no merge state; runs runtime, workspace, format and type checks      |
| `commit-msg`            | Requires Conventional Commits and rejects coauthor attribution                                  |
| `pre-merge-commit`      | Rejects ordinary merge commits                                                                  |
| `reference-transaction` | Protects main and rejects merge history or forbidden commit messages                            |
| `post-commit`           | Writes last-commit metadata inside `.git/usagekit/`; never modifies source or contacts services |

Pre-commit permits partial staging and untracked files. It does not run policy tests.
It checks current files; the privacy guard also scans indexed content. Review staged changes independently.
Full tests run through `npm run check` and during approved main promotion.
`npm run test:unit` runs Vitest; `npm run test:unit:watch` watches changes.
`npx vitest run --coverage` enforces 90% lines for reference Store and Meter, and 85% for SQLite, HTTP, client and server.
Conformance runs unchanged against memory, embedded Meter, SQLite and the remote Meter over HTTP.
The adapter converts typed validation failures to Store exceptions; other outcomes stay unchanged.
Memory and remote-memory skip `durable` and `rollingWindows`. SQLite skips only `rollingWindows`. Each run reports its skips.
There is no pre-push hook. The release allow-list and publish guard restrict publication to the approved three packages.

## Workspace layout

`usagekit.workspace.json` defines the existing inventory and allowed dependencies.

| Workspace               | Current contents                                                |
| ----------------------- | --------------------------------------------------------------- |
| `packages/core`         | Meter interface, exact quantities and domain DTO types          |
| `packages/store`        | Atomic commands, in-memory store and factory-based conformance  |
| `packages/meter`        | Embedded Meter with validation, policy and authorized reads     |
| `packages/store-sqlite` | Durable transactions, migrations and admission projection       |
| `packages/http`         | Web handlers, strict Valibot wire schemas and generated OpenAPI |
| `packages/client`       | Remote Meter with explicit accounting retries                   |
| `packages/server`       | Loopback API, token authentication and encrypted local vault    |
| `packages/cli`          | Serve, provider, budget, reporting and usage commands           |

Future packages are listed in the [plan](docs/PLAN.md#4-package-grid), without placeholder directories.
Host schema mappings stay in host repositories. Shared adapters provide mechanics only.
The npm organization is `usagekit`. Registry authentication belongs outside consumer repositories.

Web projects extend `tsconfig.base.json`; Node projects extend `tsconfig.node.json`.
Checks reject unknown directories, dependency cycles and imports bypassing package boundaries.
The local terms file `docs/adr/private-terms.txt` protects private names in indexed and scanned project files.
Without that ignored file, checks print `private-terms check skipped` and continue.
Tracked ADR files remain forbidden even when the terms file is absent.

## Design direction for review

The owner agreed to own metering/admin composition, existing host credit authorities and optional downstream export.
The [plan](docs/PLAN.md) defines delivery gates. Detailed architecture remains proposed.

- Some connections belong to groups; principal is a trusted host projection.
- Windows include calendar month, provider cycle, rolling and since-reset epochs.
- Paid wrappers are only part of the provider call inventory.
- Each adapter proves atomic commands without callback locks, including shared budgets and reservations.
- Unknown is not zero. Timeouts do not justify releasing possible charges.
- Certainty is separate from lifecycle state.
- Operation identity differs from correlation identity. Paid retries and accounting replays differ.
- Exact amounts respect Decimal(10,4), Decimal(18,6) and Decimal(12,4) adapter bounds.
- BYOK and platform funding retain separate cost owners and customer charges.
- Accounting is content-free. Every credit balance has one authority, composed into authorized admin views.
- Only the first dispatch grant may call the provider. Replay and lease expiry never grant it again.
  Recovery claims lease-free work with fencing and settles from evidence.
  Undispatched reservations expire after five minutes by default; atomic cleanup restores headroom without releasing intended dispatches.
- Query scope is not authorization. Access comes from verified server context.
  Budgets are constraints; ledgers are balance authorities.
  Caller credential and provider secret version are two different identities.

## Local architecture decisions

Draft ADRs are deliberately **ignored** under `docs/adr/`. They remain visible on
this machine but do not travel in Git, commits, clones or future releases. Do not
force-add them. Essential accepted workflow rules stay in this tracked README so
the repository does not depend on files another developer cannot obtain. The portable
design proposal is `docs/PLAN.md`; it is not ignored. ADR details explain that plan
locally and must stay consistent with it.

Start with [the local ADR index](docs/adr/0000-index.md). It distinguishes requested
repository rules from architecture proposals still awaiting review, and links the
three-consumer validation. The ignore list otherwise covers dependencies, generated
output, environment files, OS metadata and local worktrees. Source, lockfile, hooks,
tests and build configuration belong in Git.

The root [LICENSE](LICENSE) and [NOTICE](NOTICE) ship with each published package.
Live release requires clean main, a verified signed version tag, passing checks and tarball inspection.
`npm run release -- --dry-run` verifies a clean task branch without publishing or asserting that tag and registry gates passed.
