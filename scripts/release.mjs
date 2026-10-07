import "./check-runtime.mjs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assertClean, git, run } from "./lib/git.mjs";
import { publishArgs, publishable, registry, validateReleaseIdentity } from "./lib/release.mjs";
import { checkPackages } from "./check-packages.mjs";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });
assertClean();
const head = git(["rev-parse", "HEAD"]);
const version = JSON.parse(readFileSync("packages/core/package.json", "utf8")).version;
const tag = `v${version}`;
if (!values["dry-run"]) {
  validateReleaseIdentity({
    branch: git(["branch", "--show-current"]),
    head,
    tagCommit: git(["rev-parse", `${tag}^{commit}`]),
    tagType: git(["cat-file", "-t", tag]),
  });
  git(["verify-tag", tag]);
}
run("npm", ["run", "check"], { stdio: "inherit" });
run("npm", ["run", "build"], { stdio: "inherit" });
checkPackages();
run("npm", ["run", "check:consumer"], { stdio: "inherit" });
assertClean();
if (git(["rev-parse", "HEAD"]) !== head) throw new Error("HEAD changed during release checks.");
if (values["dry-run"]) {
  console.log(
    `Dry run passed for ${publishable.join(", ")}@${version}. No publish. Live release additionally requires main, verified ${tag}, and registry write access.`,
  );
} else {
  validateReleaseIdentity({
    branch: git(["branch", "--show-current"]),
    head,
    tagCommit: git(["rev-parse", `${tag}^{commit}`]),
    tagType: git(["cat-file", "-t", tag]),
  });
  git(["verify-tag", tag]);
  run("npm", ["whoami", "--registry", registry], { stdio: "inherit" });
  const file = resolve(git(["rev-parse", "--git-path", "usagekit/release.json"]));
  const nonce = crypto.randomUUID();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ nonce, head, expiresAt: Date.now() + 300000 }), {
    flag: "wx",
    mode: 0o600,
  });
  try {
    run("npm", publishArgs(), {
      stdio: "inherit",
      env: { ...process.env, USAGEKIT_RELEASE_NONCE: nonce },
    });
  } finally {
    rmSync(file, { force: true });
  }
}
