import "./check-runtime.mjs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertClean, assertCommitMessage, assertTaskBranch, git, run } from "./lib/git.mjs";
import { clearExpiredApproval, parseApprovalArgs } from "./lib/approval.mjs";

const { reviewedSha, subject: approvedSubject } = parseApprovalArgs(process.argv.slice(2));
const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
assertTaskBranch(branch);
const source = git(["rev-parse", "HEAD"]);
if (source !== reviewedSha)
  throw new Error("The approved SHA must equal the current task branch HEAD.");
if (git(["config", "--get", "core.hooksPath"]) !== ".githooks")
  throw new Error("Install repository hooks first.");
const file = resolve(git(["rev-parse", "--git-path", "usagekit/main-approval.json"]));
clearExpiredApproval(file);
assertClean();
if (git(["worktree", "list", "--porcelain"]).split("\n").includes("branch refs/heads/main")) {
  throw new Error(
    "main is checked out in another worktree. Switch that checkout safely before promotion.",
  );
}
let old;
try {
  old = git(["rev-parse", "--verify", "refs/heads/main"]);
} catch {
  old = "0".repeat(40);
}
if (!/^0+$/.test(old)) git(["merge-base", "--is-ancestor", old, source]);
run("npm", ["run", "check"], { stdio: "inherit" });
assertClean();
if (git(["rev-parse", "HEAD"]) !== source) throw new Error("HEAD changed during validation.");
const tree = git(["rev-parse", `${source}^{tree}`]);
if (!/^0+$/.test(old) && tree === git(["rev-parse", `${old}^{tree}`])) {
  throw new Error("The reviewed tree is already on main.");
}
const subject = approvedSubject ?? `chore(workspace): integrate approved ${branch}`;
assertCommitMessage(subject);
const next = git(["commit-tree", tree, ...(/^0+$/.test(old) ? [] : ["-p", old])], {
  input: `${subject}\n\nReviewed-source: ${source}\n`,
});
mkdirSync(dirname(file), { recursive: true });
clearExpiredApproval(file);
writeFileSync(file, JSON.stringify({ old, next, source, expiresAt: Date.now() + 60_000 }), {
  flag: "wx",
  mode: 0o600,
});
try {
  git(["update-ref", "-m", "usagekit approved squash", "refs/heads/main", next, old]);
} finally {
  rmSync(file, { force: true });
}
console.log(
  `Approved squash ${next} is on local main. Current task branch is unchanged. Nothing was pushed.`,
);
