import ts from "typescript";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const dir = resolve("examples/cloudflare-worker/remote"),
  stateDir = join(dir, ".state");
export const statePath = join(stateDir, "deployment.json");
const wrangler = (...args) =>
  spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, CLOUDFLARE_SEND_METRICS: "false" },
    maxBuffer: 10 * 1024 * 1024,
  });
const save = (state) =>
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account || !/^[a-f0-9]{32}$/.test(account))
  throw new Error("Set the explicitly selected CLOUDFLARE_ACCOUNT_ID");
const mode = process.argv[2] ?? "prepare";
let state;
if (!existsSync(statePath)) {
  if (mode !== "prepare") throw new Error("Prepare and review the target names first");
  const who = wrangler("whoami", "--json");
  if (who.status !== 0) throw new Error(who.stderr);
  const identity = JSON.parse(who.stdout);
  if (!identity.accounts?.some((entry) => entry.id === account))
    throw new Error("Selected account is not in authenticated memberships");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const suffix =
    new Date().toISOString().slice(0, 10).replaceAll("-", "") +
    "-" +
    randomBytes(3).toString("hex");
  state = {
    account,
    createdAt: new Date().toISOString(),
    revision: "initial",
    workers: Object.fromEntries(
      ["owner", "a", "b"].map((name) => [name, { name: `usagekit-p7-${name}-${suffix}` }]),
    ),
  };
  writeFileSync(
    join(stateDir, "secrets.json"),
    JSON.stringify({ USAGEKIT_TOKEN: randomBytes(32).toString("base64url") }),
    { mode: 0o600 },
  );
  save(state);
} else state = JSON.parse(readFileSync(statePath, "utf8"));
if (state.account !== account) throw new Error("Account differs from prepared test environment");
function config(name) {
  const templatePath = join(dir, name === "owner" ? "owner.jsonc" : "gateway.jsonc");
  const parsed = ts.parseConfigFileTextToJson(templatePath, readFileSync(templatePath, "utf8"));
  if (parsed.error) throw new Error("Invalid deployment template");
  const template = parsed.config;
  template.account_id = account;
  template.name = state.workers[name].name;
  template.main = resolve(dir, template.main);
  template.vars.REVISION = state.revision;
  template.vars.GATEWAY = name;
  if (name !== "owner")
    for (const binding of template.durable_objects.bindings)
      binding.script_name = state.workers.owner.name;
  const path = join(stateDir, `${name}.json`);
  writeFileSync(path, JSON.stringify(template, null, 2));
  return path;
}
if (mode === "prepare") {
  for (const name of ["owner", "a", "b"]) config(name);
  console.log(JSON.stringify(state, null, 2));
} else if (mode === "dry-run" || mode === "deploy" || mode === "redeploy") {
  if (mode === "redeploy") {
    if (!state.workers.owner.version)
      throw new Error("Deploy the prepared fixture before redeploying it");
    state.revision = `redeploy-${Date.now()}`;
  }
  for (const name of mode === "redeploy" ? ["owner"] : ["owner", "a", "b"]) {
    const path = config(name);
    if (mode === "deploy" && !state.workers[name].version) {
      const existing = wrangler("deployments", "list", "--config", path, "--json");
      if (existing.status === 0)
        throw new Error(
          `Refusing to overwrite an existing unowned Worker: ${state.workers[name].name}`,
        );
      if (!/10007|not found|does not exist/i.test(existing.stdout + existing.stderr))
        throw new Error(existing.stdout + existing.stderr);
    }
    const result = wrangler(
      "deploy",
      "--config",
      path,
      "--secrets-file",
      join(stateDir, "secrets.json"),
      ...(mode === "dry-run" ? ["--dry-run"] : ["--durable-objects-code-update-mode", "immediate"]),
    );
    console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.status !== 0) throw new Error(`Deployment failed: ${name}`);
    if (mode !== "dry-run") {
      const url = result.stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/);
      const version = result.stdout.match(/Current Version ID:\s*([a-f0-9-]+)/i);
      if (!version) throw new Error("Missing deployed version evidence");
      state.workers[name] = {
        ...state.workers[name],
        ...(url ? { url: url[0] } : {}),
        version: version[1],
        deployedAt: new Date().toISOString(),
      };
      save(state);
    }
  }
} else throw new Error("Use prepare, dry-run, deploy or redeploy");
