import "./check-runtime.mjs";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./lib/git.mjs";
import { publishable, releaseVersion, registry } from "./lib/release.mjs";

// A real installation outside the checkout catches undeclared dependencies and bad exports.
const directory = mkdtempSync(join(tmpdir(), "usagekit-consumer-"));
const root = resolve(".");
const development = JSON.parse(readFileSync("package.json", "utf8")).devDependencies;
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !/^npm_config_/i.test(name) && !["NPM_TOKEN", "NODE_AUTH_TOKEN"].includes(name),
  ),
);
for (const name of ["user", "global"]) writeFileSync(join(directory, `${name}.npmrc`), "");
env.NPM_CONFIG_USERCONFIG = join(directory, "user.npmrc");
env.NPM_CONFIG_GLOBALCONFIG = join(directory, "global.npmrc");
const consumer = (command, args) => run(command, args, { cwd: directory, env, stdio: "inherit" });
try {
  const tarballs = publishable.map((name) => {
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
    `Anonymous tarball consumer passed for ${publishable.length} packages@${releaseVersion}.`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
