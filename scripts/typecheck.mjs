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
// Browser app of the local server: host aliases and DOM types, outside the Node project.
run(["-p", "packages/server/ui/tsconfig.json"]);
for (const [directory, config] of [
  ["examples/cloudflare-worker", "wrangler.jsonc"],
  ["examples/cloudflare-worker/remote", "owner.jsonc"],
]) {
  const types = spawnSync(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "types",
      `${directory}/worker-configuration.d.ts`,
      "--config",
      `${directory}/${config}`,
    ],
    { stdio: "inherit", env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" } },
  );
  if (types.status !== 0) process.exit(types.status ?? 1);
  run(["-p", `${directory}/tsconfig.json`]);
}
await import("./build-conformance.mjs");
await import("./copy-assets.mjs");
