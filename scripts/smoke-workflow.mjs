// Manual smoke test of the full workflow in a disposable copy, never this repository.
// Separate from npm test because approvals run the full check, including policy tests.
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { git, run } from "./lib/git.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "usagekit-workflow-"));
const g = (args) => git(args, { cwd });
const n = (args) => run(process.execPath, args, { cwd });
try {
  cpSync(source, cwd, {
    recursive: true,
    filter: (path) => ![".git", "node_modules", "dist", "adr", ".wt"].includes(basename(path)),
  });
  symlinkSync(join(source, "node_modules"), join(cwd, "node_modules"), "dir");
  g(["init", "-b", "chore/fixture"]);
  g(["config", "user.name", "Example Developer"]);
  g(["config", "user.email", "developer@example.com"]);
  n(["scripts/install-hooks.mjs"]);
  g(["add", "."]);
  g(["commit", "-m", "chore(repo): prepare smoke fixture"]);
  const first = g(["rev-parse", "HEAD"]);
  assert.equal(JSON.parse(readFileSync(join(cwd, ".git/usagekit/last-commit.json"))).commit, first);
  assert.throws(() => g(["update-ref", "refs/heads/main", first]), /exact reviewed squash/);
  const approvalFile = join(cwd, ".git/usagekit/main-approval.json");
  writeFileSync(approvalFile, JSON.stringify({ expiresAt: Date.now() + 60_000 }));
  assert.throws(
    () => n(["scripts/approve-main.mjs", "--approved-sha", first]),
    /main-approval.json.*seconds remaining/,
  );
  writeFileSync(approvalFile, JSON.stringify({ expiresAt: Date.now() - 1 }));
  n(["scripts/approve-main.mjs", "--approved-sha", first]);
  assert.equal(g(["rev-parse", "main^{tree}"]), g(["rev-parse", "HEAD^{tree}"]));
  assert.equal(g(["rev-list", "--count", "main"]), "1");
  g(["switch", "-c", "feat/smoke-change", "main"]);
  const coreFile = join(cwd, "packages/core/src/index.ts");
  const coreSource = readFileSync(coreFile, "utf8");
  writeFileSync(coreFile, coreSource + "// Disposable workflow probe.\n");
  g(["add", "packages/core/src/index.ts"]);
  writeFileSync(coreFile, coreSource + "// Another unstaged probe.\n");
  writeFileSync(join(cwd, "untracked.txt"), "Untracked files do not block pre-commit.\n");
  g(["commit", "-m", "test(core): change disposable fixture"]);
  assert.match(readFileSync(coreFile, "utf8"), /Another unstaged probe/);
  g(["restore", "packages/core/src/index.ts"]);
  rmSync(join(cwd, "untracked.txt"));
  const second = g(["rev-parse", "HEAD"]);
  n(["scripts/approve-main.mjs", "--approved-sha", second]);
  assert.equal(g(["rev-list", "--count", "main"]), "2");
  assert.equal(g(["rev-list", "--min-parents=2", "main"]), "");
  assert.equal(g(["symbolic-ref", "--short", "HEAD"]), "feat/smoke-change");
  mkdirSync(join(cwd, "docs/adr"), { recursive: true });
  writeFileSync(join(cwd, "docs/adr/probe.md"), "# Local only\n");
  assert.equal(g(["check-ignore", "docs/adr/probe.md"]), "docs/adr/probe.md");
  g(["add", "-f", "docs/adr/probe.md"]);
  assert.throws(
    () => g(["commit", "-m", "docs(adr): attempt forbidden tracking"]),
    /ADR files must remain untracked/,
  );
  assert.equal(g(["rev-parse", "HEAD"]), second);
  console.log(
    "Workflow smoke passed: partial staging and untracked files allowed, active/expired approvals, two squashes, protected main, force-added ADR guard.",
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
