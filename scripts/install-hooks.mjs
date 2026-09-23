import "./check-runtime.mjs";
import { chmodSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { git } from "./lib/git.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
if (git(["rev-parse", "--show-toplevel"]) !== root.replace(/\/$/, "")) {
  throw new Error("Run setup from the usagekit repository root.");
}
for (const name of readdirSync(new URL("../.githooks/", import.meta.url))) {
  chmodSync(new URL(`../.githooks/${name}`, import.meta.url), 0o755);
}
chmodSync(new URL("./run-hook.sh", import.meta.url), 0o755);
git(["config", "--local", "core.hooksPath", ".githooks"]);
git(["config", "--local", "pull.ff", "only"]);
git(["config", "--local", "merge.ff", "only"]);
console.log("Installed local Git hooks. Main protection and npm publication guards are active.");
