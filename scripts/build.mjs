import { readFileSync, rmSync, cpSync } from "node:fs";
import { run } from "./lib/git.mjs";

const projects = JSON.parse(readFileSync("usagekit.workspace.json", "utf8")).projects;
for (const project of projects) rmSync(`${project.path}/dist`, { recursive: true, force: true });
run(process.execPath, ["node_modules/typescript/bin/tsc", "-b"], { stdio: "inherit" });
await import("./build-conformance.mjs");
await import("./copy-assets.mjs");
// Local server UI on the base registry blocks, served from packages/server/dist/ui.
run(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "packages/server/ui/vite.config.ts",
    "--logLevel",
    "error",
  ],
  { stdio: "inherit" },
);
run("npm", ["run", "build", "--workspace", "@usagekit/site"], { stdio: "inherit" });
for (const name of ["core", "store", "meter"])
  for (const file of ["LICENSE", "NOTICE"]) cpSync(file, `packages/${name}/${file}`);
run("npm", ["rebuild", "@usagekit/cli"], { stdio: "inherit" });
