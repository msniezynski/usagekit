import { spawnSync } from "node:child_process";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `${command} exited with ${result.status}`);
  }
  return result.stdout?.trim() ?? "";
}

export function git(args, options = {}) {
  return run("git", args, options);
}

export function assertClean({ staged = false } = {}) {
  const args = staged ? ["diff", "--quiet"] : ["diff", "HEAD", "--quiet"];
  git(args);
  if (git(["ls-files", "--others", "--exclude-standard"])) {
    throw new Error("Stage or remove untracked project files before checking a commit.");
  }
}

export function assertCommitMessage(message) {
  if (/co[- ]?authored[- ]by\s*:/i.test(message)) {
    throw new Error(
      "Co-Authored-By attribution is not allowed in commit messages or descriptions.",
    );
  }
  const subject = message.split(/\r?\n/)[0];
  if (
    !/^(feat|fix|docs|test|refactor|perf|build|ci|chore|revert)(\([a-z0-9/-]+\))?!?: .+/.test(
      subject,
    )
  ) {
    throw new Error(
      "Use a Conventional Commit subject, for example chore(repo): prepare workspace.",
    );
  }
}

export function assertTaskBranch(branch) {
  if (
    !/^(feat|fix|docs|test|refactor|perf|build|ci|chore|revert)\/[a-z0-9][a-z0-9._/-]*$/.test(
      branch,
    )
  ) {
    throw new Error(
      "Work on a named task branch such as feat/meter-contract, never main or detached HEAD.",
    );
  }
}
