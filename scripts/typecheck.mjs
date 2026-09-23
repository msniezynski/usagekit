import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const tsc = "node_modules/typescript/bin/tsc";
const run = (args) => {
  const result = spawnSync(process.execPath, [tsc, ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(["-b"]);
for (const project of JSON.parse(readFileSync("usagekit.workspace.json", "utf8")).projects) {
  run(["-p", `${project.path}/tsconfig.test.json`]);
}
await import("./build-conformance.mjs");
await import("./copy-assets.mjs");
