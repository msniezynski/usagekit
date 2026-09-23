import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertCommitMessage, assertTaskBranch, git, run } from "./lib/git.mjs";

const [hook, ...args] = process.argv.slice(2);
const zero = /^0+$/;

function reject(message) {
  throw new Error(message);
}

function protectRefs(state, input) {
  if (state !== "prepared") return;
  for (const line of input.trim().split("\n").filter(Boolean)) {
    const [old, next, ref] = line.split(" ");
    if (!ref?.startsWith("refs/heads/")) continue;
    if (ref === "refs/heads/main") {
      if (zero.test(next)) reject("Deleting main is not allowed.");
      const file = git(["rev-parse", "--git-path", "usagekit/main-approval.json"]);
      const approval = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
      if (
        !approval ||
        approval.next !== next ||
        approval.old !== old ||
        approval.expiresAt < Date.now() ||
        git(["show", "-s", "--format=%T", next]) !==
          git(["show", "-s", "--format=%T", approval.source]) ||
        git(["show", "-s", "--format=%P", next]) !== (zero.test(old) ? "" : old)
      )
        reject("main accepts only an exact reviewed squash through npm run approve:main.");
    }
    if (zero.test(next)) continue;
    const range = zero.test(old) ? [next] : [next, `^${old}`];
    if (git(["rev-list", "--min-parents=2", ...range])) {
      reject(
        "Merge commits are not allowed. Rebase task branches; integrate approved work by squash.",
      );
    }
    for (const commit of git(["rev-list", ...range])
      .split("\n")
      .filter(Boolean)) {
      assertCommitMessage(git(["show", "-s", "--format=%B", commit]));
    }
  }
}

try {
  if (hook === "reference-transaction") {
    protectRefs(args[0], readFileSync(0, "utf8"));
  } else if (hook === "pre-merge-commit") {
    reject("Merge commits are disabled. Use rebase, then an approved squash integration.");
  } else if (hook === "commit-msg") {
    assertCommitMessage(readFileSync(args[0], "utf8"));
  } else if (hook === "pre-commit") {
    assertTaskBranch(git(["symbolic-ref", "--quiet", "--short", "HEAD"]));
    if (existsSync(git(["rev-parse", "--git-path", "MERGE_HEAD"])))
      reject("Merge commits are disabled.");
    for (const script of ["check:runtime", "check:workspace", "check:format", "typecheck"])
      run("npm", ["run", script], { stdio: "inherit" });
  } else if (hook === "post-commit") {
    const file = resolve(git(["rev-parse", "--git-path", "usagekit/last-commit.json"]));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        { commit: git(["rev-parse", "HEAD"]), checkedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  } else {
    reject(`Unknown hook: ${hook}`);
  }
} catch (error) {
  console.error(`[usagekit] ${error.message}`);
  process.exitCode = hook === "post-commit" ? 0 : 1;
}
