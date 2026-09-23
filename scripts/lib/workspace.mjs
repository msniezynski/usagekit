import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import ts from "typescript";

export function validateGraph(projects) {
  const byName = new Map(projects.map((p) => [p.name, p]));
  if (byName.size !== projects.length) throw new Error("Workspace names must be unique.");
  const complete = new Set();
  function visit(name, stack = new Set()) {
    if (stack.has(name)) throw new Error(`Circular workspace dependency: ${name}`);
    if (complete.has(name)) return;
    const project = byName.get(name);
    if (!project) throw new Error(`Unknown workspace dependency: ${name}`);
    for (const dep of project.allows) visit(dep, new Set([...stack, name]));
    complete.add(name);
  }
  for (const name of byName.keys()) visit(name);
}

export function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", ".git", ".wt", "coverage", "adr"].includes(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function validateImports(project, source, file, dependencies) {
  for (const { fileName: specifier } of ts.preProcessFile(source, true, true).importedFiles) {
    if (specifier.startsWith(".")) {
      const target = resolve(file, "..", specifier);
      const local = relative(resolve(project.path, "src"), target);
      if (local === ".." || local.startsWith(`..${sep}`) || local.startsWith(sep)) {
        throw new Error(`Cross-workspace relative import in ${file}: ${specifier}`);
      }
      continue;
    }
    if (specifier.startsWith("node:")) {
      if (project.runtime === "web")
        throw new Error(`Node-only import in web-standard ${project.name}.`);
      continue;
    }
    const name = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (!Object.hasOwn(dependencies, name))
      throw new Error(`Undeclared import in ${file}: ${specifier}`);
  }
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
