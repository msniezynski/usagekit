import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { legacy, styleMap, styleSource, styles } from "../packages/registry/styles/styles.mjs";

// Builds packages/registry/dist/r: r/styles/<style>/<name>.json for every shadcn style, with that
// style's sheet baked into the sources, and a registry.json per style. r/radix and r/base keep
// New York and Base UI Vega, and r/<name>.json defaults to radix. Base reads the same index with
// its own source directory; shared files are symlinks, so reading follows them.
const { values } = parseArgs({ options: { out: { type: "string" } } });
const root = resolve(import.meta.dirname, "..");
const registry = join(root, "packages/registry");
const out = resolve(values.out ?? join(registry, "dist"));
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const version = (name) => read(join(root, "packages", name.split("/")[1], "package.json")).version;
const index = read(join(registry, "registry.json"));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

rmSync(join(out, "r"), { recursive: true, force: true });
const maps = new Map();
const mapFor = (sheet) => {
  if (!maps.has(sheet)) maps.set(sheet, styleMap(sheet));
  return maps.get(sheet);
};
function emit(dir, variant, sheet, root = false) {
  mkdirSync(dir, { recursive: true });
  const items = index.items.map((item) => ({
    ...item,
    dependencies: item.dependencies.map((d) => `${d}@${version(d)}`),
    files: item.files.map((f) => ({
      ...f,
      path: f.path.replace(/^registry\/radix\//, `registry/${variant}/`),
    })),
  }));
  write(join(dir, "registry.json"), { ...index, items });
  for (const item of items) {
    const resolved = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      ...item,
      files: item.files.map((f) => ({
        ...f,
        content: styleSource(readFileSync(join(registry, f.path), "utf8"), mapFor(sheet)),
      })),
    };
    write(join(dir, `${item.name}.json`), resolved);
    if (root) write(join(out, "r", `${item.name}.json`), resolved);
  }
}
for (const style of styles) emit(join(out, "r", "styles", style.name), style.variant, style.sheet);
for (const variant of ["radix", "base"]) {
  const style = styles.find((candidate) => candidate.name === legacy[variant]);
  emit(join(out, "r", variant), variant, style.sheet, variant === "radix");
}
console.log(
  `Registry built: ${index.items.length} blocks in ${styles.length} styles, plus radix and base, in ${out}/r`,
);
