import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { git } from "./git.mjs";

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
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
  const terms = readFileSync(termsFile, "utf8")
    .split(/\r?\n/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  const tracked = git(["ls-files", "-z"], { cwd: root }).split("\0").filter(Boolean);
  const paths = new Set(tracked.map((path) => resolve(root, path)));
  for (const path of ["docs/PLAN.md", "README.md"]) paths.add(resolve(root, path));
  for (const dir of ["packages", "apps", "scripts"]) {
    if (existsSync(resolve(root, dir)))
      for (const path of filesUnder(resolve(root, dir))) paths.add(path);
  }
  const check = (content, path) => {
    if (terms.some((term) => content.toLowerCase().includes(term)))
      throw new Error(`Private term found in ${path}. Move private evidence to ignored ADRs.`);
  };
  // Check staged contents too, so a clean worktree cannot conceal an unsafe index.
  for (const path of tracked) check(git(["show", `:${path}`], { cwd: root }), path);
  for (const path of paths) if (existsSync(path)) check(readFileSync(path, "utf8"), path);
  console.log(`private-terms check passed (${paths.size} files; index and worktree)`);
}
