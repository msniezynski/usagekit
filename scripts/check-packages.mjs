import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./lib/git.mjs";
import { privatePackageTerms, publishable, validatePackFiles } from "./lib/release.mjs";

export function checkPackages({ requireBuild = true } = {}) {
  const termsFile = "docs/adr/private-terms.txt";
  const terms = existsSync(termsFile) ? privatePackageTerms(readFileSync(termsFile, "utf8")) : [];
  for (const name of publishable) {
    const directory = `packages/${name.split("/")[1]}`;
    if (!existsSync(`${directory}/dist/index.js`) && !requireBuild) continue;
    const [pack] = JSON.parse(run("npm", ["pack", "--dry-run", "--json", "--workspace", name]));
    validatePackFiles(
      pack.files.map((f) => f.path),
      terms,
      name === "@usagekit/store",
    );
    for (const { path } of pack.files) {
      const contents = readFileSync(`${directory}/${path}`, "utf8").toLowerCase();
      if (terms.some((term) => contents.includes(term)))
        throw new Error(`Private term in tarball content: ${name}/${path}`);
    }
    console.log(
      `Tarball verified: ${name}@${pack.version}, ${pack.files.length} files, no source/test files or private terms.`,
    );
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkPackages();
