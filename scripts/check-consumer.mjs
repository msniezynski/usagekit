import "./check-runtime.mjs";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { git, run } from "./lib/git.mjs";
import { publishable, releaseVersion, registry } from "./lib/release.mjs";

// A real installation outside the checkout catches undeclared dependencies and bad exports.
const directory = mkdtempSync(join(tmpdir(), "usagekit-consumer-"));
const { values } = parseArgs({ options: { registry: { type: "boolean" } } });
const root = resolve(".");
const development = JSON.parse(readFileSync("package.json", "utf8")).devDependencies;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) =>
      !/^npm_config_/i.test(name) &&
      ![
        "NPM_TOKEN",
        "NODE_AUTH_TOKEN",
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "ACTIONS_ID_TOKEN_REQUEST_URL",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      ].includes(name),
  ),
);
for (const name of ["user", "global"]) writeFileSync(join(directory, `${name}.npmrc`), "");
env.NPM_CONFIG_USERCONFIG = join(directory, "user.npmrc");
env.NPM_CONFIG_GLOBALCONFIG = join(directory, "global.npmrc");
const consumer = (command, args) => run(command, args, { cwd: directory, env, stdio: "inherit" });
try {
  const metadata = new Map();
  if (values.registry) {
    await Promise.all(
      publishable.map(async (name) => {
        const deadline = Date.now() + 900000;
        for (;;) {
          const response = await fetch(`${registry}${encodeURIComponent(name)}`, {
            headers: { "cache-control": "no-cache" },
            signal: AbortSignal.timeout(30000),
          });
          if (response.ok) {
            const manifest = (await response.json()).versions?.[releaseVersion];
            if (manifest) {
              assert.equal(manifest.name, name);
              assert.equal(manifest.version, releaseVersion);
              if (manifest.gitHead) assert.equal(manifest.gitHead, git(["rev-parse", "HEAD"]));
              metadata.set(name, manifest);
              break;
            }
          } else if (![404, 429, 500, 502, 503, 504].includes(response.status)) {
            throw new Error(`Registry verification failed for ${name}: HTTP ${response.status}.`);
          }
          if (Date.now() + 60000 >= deadline)
            throw new Error(`Registry propagation timed out: ${name}.`);
          console.log(`Waiting for registry propagation: ${name}@${releaseVersion}.`);
          await setTimeout(60000);
        }
      }),
    );
  }
  const tarballs = values.registry
    ? publishable.map((name) => `${name}@${releaseVersion}`)
    : publishable.map((name) => {
        const [pack] = JSON.parse(
          run("npm", ["pack", "--json", "--workspace", name, "--pack-destination", directory]),
        );
        assert.equal(pack.version, releaseVersion);
        return join(directory, pack.filename);
      });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ name: "usagekit-release-consumer", private: true, type: "module" }),
  );
  consumer("npm", [
    "install",
    "--prefer-online",
    "--cache",
    join(directory, "cache"),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    "--registry",
    registry,
    ...tarballs,
    ...["react", "react-dom", "@types/react", "@types/react-dom", "@types/node", "typescript"].map(
      (name) => `${name}@${development[name]}`,
    ),
  ]);
  for (const name of publishable) {
    const path = join(directory, "node_modules", name);
    const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    assert.equal(manifest.version, releaseVersion);
    assert.equal(manifest.private, undefined);
    if (values.registry) {
      const nameOnDisk = name.slice("@usagekit/".length);
      const local = join(root, "packages", nameOnDisk);
      assert.deepEqual(manifest, JSON.parse(readFileSync(join(local, "package.json"), "utf8")));
      const lock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
      const installed = lock.packages[`node_modules/${name}`];
      assert.equal(installed.integrity, metadata.get(name).dist.integrity);
      assert.ok(installed.resolved.startsWith(registry));
      const [pack] = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--workspace", name]));
      const publishedFiles = [];
      for (const file of readdirSync(path, { recursive: true, withFileTypes: true })) {
        if (file.isDirectory()) continue;
        assert.ok(file.isFile(), "Unexpected package link.");
        const absolute = join(file.parentPath, file.name);
        const relative = absolute.slice(path.length + 1);
        publishedFiles.push(relative);
        assert.ok(/^(package\.json|LICENSE|NOTICE|dist\/.+\.(js|d\.ts))$/.test(relative));
        if (relative !== "package.json")
          assert.deepEqual(readFileSync(absolute), readFileSync(join(local, relative)));
      }
      assert.deepEqual(publishedFiles.sort(), pack.files.map((file) => file.path).sort());
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith("@usagekit/")) assert.ok(publishable.includes(dependency));
    }
  }
  copyFileSync(
    join(root, "scripts/fixtures/release-consumer.tsx"),
    join(directory, "consumer.tsx"),
  );
  consumer(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "consumer.tsx",
    "--outDir",
    "output",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--jsx",
    "react-jsx",
  ]);
  consumer(process.execPath, ["output/consumer.js"]);
  console.log(
    `Anonymous ${values.registry ? "registry" : "tarball"} consumer passed for ${publishable.length} packages@${releaseVersion}.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
