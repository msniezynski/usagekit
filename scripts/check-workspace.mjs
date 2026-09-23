import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./lib/git.mjs";
import { filesUnder, readJson, validateGraph, validateImports } from "./lib/workspace.mjs";
import { satisfiesRuntimeRange } from "./lib/runtime.mjs";
import { checkPrivateTerms } from "./lib/private-terms.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const workspace = readJson("usagekit.workspace.json");
validateGraph(workspace.projects);
const rootManifest = readJson("package.json");
if (rootManifest.private !== true || workspace.publication !== "blocked")
  throw new Error("Local-only publication guard changed.");
if (git(["ls-files", "--", "docs/adr"]))
  throw new Error("ADR files must remain untracked, including force-added files.");
checkPrivateTerms(root);
if (!satisfiesRuntimeRange(readFileSync(".nvmrc", "utf8").trim(), rootManifest.engines.node))
  throw new Error("Runtime pins disagree.");
const expected = new Set(workspace.projects.map((p) => p.path));
const actual = ["packages", "apps"].flatMap((dir) =>
  (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [])
    .filter((p) => p.isDirectory())
    .map((p) => `${dir}/${p.name}`),
);
if (actual.length !== expected.size || actual.some((p) => !expected.has(p)))
  throw new Error("Workspace directory inventory differs from usagekit.workspace.json.");
const refs = readJson("tsconfig.json").references.map((r) => r.path.replace(/^\.\//, ""));
if (refs.length !== expected.size || refs.some((p) => !expected.has(p)))
  throw new Error("Root TypeScript references do not cover all projects.");
for (const project of workspace.projects) {
  const config = readJson(`${project.path}/tsconfig.json`);
  const base = { web: "tsconfig.base.json", node: "tsconfig.node.json" }[project.runtime];
  if (!base || resolve(project.path, config.extends ?? "") !== resolve(base))
    throw new Error(`Runtime config mismatch: ${project.path} must extend ${base}.`);
  const manifest = readJson(`${project.path}/package.json`);
  if (
    manifest.name !== project.name ||
    manifest.private !== true ||
    manifest.license !== "UNLICENSED"
  ) {
    throw new Error(`Invalid local package identity/publication guard: ${project.path}`);
  }
  if (manifest.scripts?.prepublishOnly !== "node ../../scripts/deny-publish.mjs")
    throw new Error(`Missing publish guard in ${project.path}`);
  const deps = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
  };
  for (const [name, version] of Object.entries(deps)) {
    if (name.startsWith("@usagekit/") && (!project.allows.includes(name) || version !== "0.0.0")) {
      throw new Error(`Disallowed workspace dependency in ${project.name}: ${name}`);
    }
  }
  for (const file of filesUnder(resolve(project.path, "src"))) {
    if (/\.[cm]?[jt]sx?$/.test(file))
      validateImports(project, readFileSync(file, "utf8"), file, deps);
  }
}
const readmes = filesUnder(root).filter((f) => /(^|\/)readme\.md$/i.test(f));
if (readmes.length !== 1 || readmes[0] !== resolve("README.md"))
  throw new Error("Keep one root README.md.");
console.log(
  `Workspace boundaries verified: ${workspace.projects.length} private projects, runtime configs, one README, no tracked ADRs.`,
);
