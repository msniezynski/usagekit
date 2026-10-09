import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prettier from "prettier";
import { styleMap, styleSource } from "../packages/registry/styles/styles.mjs";

// The local dashboard is a Base UI Vega host: its copies of the registry blocks are the base
// sources with the Vega sheet baked in, as `shadcn add` writes them for base-vega, then formatted
// like the rest of the repository.
const root = resolve(import.meta.dirname, "..");
const target = join(root, "packages/server/ui/components/usagekit");
const map = styleMap("vega");
const check = process.argv.includes("--check");
let stale = 0;
for (const file of readdirSync(target).filter((name) => name.endsWith(".tsx"))) {
  const block = file.replace(/\.tsx$/, "");
  const source = join(root, "packages/registry/registry/base", block, file);
  const content = await prettier.format(styleSource(readFileSync(source, "utf8"), map), {
    ...(await prettier.resolveConfig(join(target, file))),
    filepath: join(target, file),
  });
  if (readFileSync(join(target, file), "utf8") === content) continue;
  stale += 1;
  if (check) console.error(`Stale dashboard block: ${file}`);
  else writeFileSync(join(target, file), content);
}
if (check && stale) process.exitCode = 1;
console.log(check ? `${stale} stale dashboard blocks` : `${stale} dashboard blocks updated`);
