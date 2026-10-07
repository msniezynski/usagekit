import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { git } from "./git.mjs";

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["dist", "node_modules"].includes(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function checkPrivateTerms(root) {
  const termsFile = resolve(root, "docs/adr/private-terms.txt");
  if (!existsSync(termsFile)) {
    console.log("private-terms check skipped");
    return;
  }
  // One term per line. "term allow: packages/site/ docs/SITE.md" permits it only under those
  // repository paths; a trailing slash allows a directory, otherwise the exact file.
  const rules = readFileSync(termsFile, "utf8")
    .split(/\r?\n/)
    .map((line) => {
      const [term = "", allow = ""] = line.split(/\s+allow:/i);
      return { term: term.trim().toLowerCase(), allow: allow.split(/\s+/).filter(Boolean) };
    })
    .filter((rule) => rule.term);
  const permitted = (rule, path) =>
    rule.allow.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));
  const tracked = git(["ls-files", "-z"], { cwd: root }).split("\0").filter(Boolean);
  const paths = new Set(tracked.map((path) => resolve(root, path)));
  for (const path of ["docs/PLAN.md", "README.md"]) paths.add(resolve(root, path));
  for (const dir of ["packages", "apps", "scripts"]) {
    if (existsSync(resolve(root, dir)))
      for (const path of filesUnder(resolve(root, dir))) paths.add(path);
  }
  const check = (content, path) => {
    const file = relative(root, resolve(root, path)).split(sep).join("/");
    const text = content.toLowerCase();
    if (rules.some((rule) => text.includes(rule.term) && !permitted(rule, file)))
      throw new Error(`Private term found in ${path}. Move private evidence to ignored ADRs.`);
  };
  // Check staged contents too, so a clean worktree cannot conceal an unsafe index.
  for (const path of tracked) check(git(["show", `:${path}`], { cwd: root }), path);
  for (const path of paths) if (existsSync(path)) check(readFileSync(path, "utf8"), path);
  console.log(`private-terms check passed (${paths.size} files; index and worktree)`);
}
