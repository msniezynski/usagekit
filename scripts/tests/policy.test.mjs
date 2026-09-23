import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCommitMessage, assertTaskBranch, git, run } from "../lib/git.mjs";
import { validateGraph, validateImports } from "../lib/workspace.mjs";

const hook = fileURLToPath(new URL("../git-hook.mjs", import.meta.url));

test("commit messages reject coauthor trailers anywhere in the body", () => {
  assertCommitMessage("feat(core): add exact quantities\n\nReviewed locally.");
  assert.throws(
    () =>
      assertCommitMessage(
        "feat(core): add quantities\n\nCo-Authored-By: Example <dev@example.com>",
      ),
    /attribution/,
  );
  assert.throws(() => assertCommitMessage("Merge branch feat/example"), /Conventional/);
});

test("task work refuses main and detached HEAD", () => {
  assertTaskBranch("chore/bootstrap-workspace");
  assert.throws(() => assertTaskBranch("main"), /task branch/);
  assert.throws(() => assertTaskBranch("HEAD"), /task branch/);
});

test("workspace graph rejects cycles and unknown adapters", () => {
  validateGraph([
    { name: "core", allows: [] },
    { name: "meter", allows: ["core"] },
  ]);
  assert.throws(
    () =>
      validateGraph([
        { name: "core", allows: ["meter"] },
        { name: "meter", allows: ["core"] },
      ]),
    /Circular/,
  );
  assert.throws(() => validateGraph([{ name: "core", allows: ["missing"] }]), /Unknown/);
});

test("source boundaries reject Node, undeclared and relative bypass imports", () => {
  const project = { name: "@usagekit/core", path: "packages/core", runtime: "web" };
  const file = resolve("packages/core/src/index.ts");
  validateImports(project, 'export type { Value } from "./value.js";', file, {});
  assert.throws(() => validateImports(project, 'import fs from "node:fs";', file, {}), /Node-only/);
  assert.throws(
    () => validateImports(project, 'export * from "../../wallet/src/index.js";', file, {}),
    /relative/,
  );
  assert.throws(
    () => validateImports(project, 'const p = import("@usagekit/wallet");', file, {}),
    /Undeclared/,
  );
});

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "usagekit-policy-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const g = (args, options = {}) => git(args, { cwd, ...options });
  g(["init", "-b", "chore/fixture"]);
  g(["config", "user.name", "Example Developer"]);
  g(["config", "user.email", "developer@example.com"]);
  writeFileSync(join(cwd, "file.txt"), "base\n");
  g(["add", "file.txt"]);
  g(["commit", "-m", "chore(test): create fixture"]);
  const base = g(["rev-parse", "HEAD"]);
  const hooks = join(cwd, ".git", "test-hooks");
  mkdirSync(hooks);
  // JSON string literals are evaluated by Node here, never by a shell.
  writeFileSync(
    join(hooks, "reference-transaction"),
    `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');\nconst r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(hook)},'reference-transaction',...process.argv.slice(2)],{stdio:'inherit'});\nprocess.exit(r.status ?? 1);\n`,
    { mode: 0o755 },
  );
  g(["config", "core.hooksPath", hooks]);
  const tree = g(["rev-parse", "HEAD^{tree}"]);
  const commit = (parents = [base], message = "chore(test): reviewed candidate") =>
    g(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p])], { input: `${message}\n` });
  function authorize(next, old = "0".repeat(40), source = base, expiresAt = Date.now() + 60000) {
    const dir = join(cwd, ".git", "usagekit");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "main-approval.json"),
      JSON.stringify({ next, old, source, expiresAt }),
    );
  }
  return { cwd, g, base, commit, authorize };
}

test("Git rejects direct creation of main without approval", (t) => {
  const { g, base } = fixture(t);
  assert.throws(() => g(["update-ref", "refs/heads/main", base]), /exact reviewed squash/);
  assert.throws(() => g(["rev-parse", "--verify", "main"]));
});

test("Git accepts an authorized root squash, then protects main deletion", (t) => {
  const { g, commit, authorize } = fixture(t);
  const next = commit([]);
  authorize(next);
  g(["update-ref", "refs/heads/main", next, "0".repeat(40)]);
  assert.equal(g(["rev-parse", "main"]), next);
  assert.equal(g(["show", "-s", "--format=%P", "main"]), "");
  assert.throws(() => g(["update-ref", "-d", "refs/heads/main"]), /Deleting main/);
});

test("Git rejects expired approval and altered candidate identity", (t) => {
  const { g, base, commit, authorize } = fixture(t);
  const next = commit([]);
  authorize(next, "0".repeat(40), base, Date.now() - 1);
  assert.throws(() => g(["update-ref", "refs/heads/main", next]), /exact reviewed squash/);
  authorize(base);
  assert.throws(() => g(["update-ref", "refs/heads/main", next]), /exact reviewed squash/);
});

test("Git accepts a one-parent approved squash and rejects stale-parent approval", (t) => {
  const { g, commit, authorize } = fixture(t);
  const main = commit([]);
  authorize(main);
  g(["update-ref", "refs/heads/main", main]);
  const next = commit([main], "chore(test): second approved squash");
  authorize(next, main);
  g(["update-ref", "refs/heads/main", next, main]);
  assert.equal(g(["show", "-s", "--format=%P", "main"]), main);
  const wrongParent = commit([]);
  authorize(wrongParent, next);
  assert.throws(
    () => g(["update-ref", "refs/heads/main", wrongParent, next]),
    /exact reviewed squash/,
  );
});

test("Git rejects actual two-parent commits and coauthor messages on task refs", (t) => {
  const { g, base, commit } = fixture(t);
  const other = commit([], "chore(test): other parent");
  const merge = commit([base, other]);
  assert.throws(() => g(["update-ref", "refs/heads/feat/merge", merge]), /Merge commits/);
  const coauthor = commit(
    [base],
    "feat(test): sample\n\nCo-Authored-By: Example <dev@example.com>",
  );
  assert.throws(() => g(["update-ref", "refs/heads/feat/attribution", coauthor]), /attribution/);
});

test("publication guard fails without contacting a service", () => {
  const deny = fileURLToPath(new URL("../deny-publish.mjs", import.meta.url));
  assert.throws(() => run(process.execPath, [deny]), /Publication is disabled/);
});

test("post-commit writes only git-local audit metadata", (t) => {
  const { cwd, base } = fixture(t);
  run(process.execPath, [hook, "post-commit"], { cwd });
  const data = JSON.parse(readFileSync(join(cwd, ".git", "usagekit", "last-commit.json"), "utf8"));
  assert.equal(data.commit, base);
  assert.ok(data.checkedAt);
});

test("test dependency allowlist preserves production and web boundaries", () => {
  const project = { name: "@usagekit/core", path: "packages/core", runtime: "web" };
  const file = resolve("packages/core/src/example.test.ts");
  validateImports(project, 'import {test} from "vitest";', file, {}, ["vitest", "fast-check"]);
  assert.throws(
    () =>
      validateImports(
        project,
        'import {test} from "vitest";',
        resolve("packages/core/src/index.ts"),
        {},
      ),
    /Undeclared/,
  );
  assert.throws(
    () => validateImports(project, 'import fs from "node:fs";', file, {}, ["vitest"]),
    /Node-only/,
  );
  assert.throws(
    () => validateImports(project, 'import "../../store/src/index.js";', file, {}, ["vitest"]),
    /relative/,
  );
});

test("client may import HTTP DTO types but never runtime HTTP code", () => {
  const project = {
    name: "@usagekit/client",
    path: "packages/client",
    runtime: "web",
    typeAllows: ["@usagekit/http"],
  };
  const file = resolve("packages/client/src/index.ts"),
    deps = { "@usagekit/http": "0.0.0" };
  validateImports(project, 'import type { WireInputs } from "@usagekit/http";', file, deps);
  assert.throws(
    () =>
      validateImports(project, 'import { createUsageHandlers } from "@usagekit/http";', file, deps),
    /Type-only/,
  );
});
