import { readFileSync } from "node:fs";
import { satisfiesRuntimeRange } from "./lib/runtime.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!satisfiesRuntimeRange(process.versions.node, manifest.engines.node)) {
  throw new Error(`Use Node ${manifest.engines.node} (nvm use); found ${process.versions.node}.`);
}
const npmVersion = process.env.npm_config_user_agent?.match(/^npm\/([^ ]+)/)?.[1];
if (npmVersion && !satisfiesRuntimeRange(npmVersion, manifest.engines.npm)) {
  throw new Error(`Use npm ${manifest.engines.npm}; found ${npmVersion}.`);
}
