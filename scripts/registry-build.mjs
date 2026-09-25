import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

// Builds packages/registry/dist/r: r/<variant>/<name>.json for radix and base, a registry.json
// per variant, and r/<name>.json defaulting to radix. Base reads the same index with its own
// source directory; shared files are symlinks, so reading follows them.
const { values } = parseArgs({ options: { out: { type: "string" } } });
const root = resolve(import.meta.dirname, "..");
const registry = join(root, "packages/registry");
const out = resolve(values.out ?? join(registry, "dist"));
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const version = (name) => read(join(root, "packages", name.split("/")[1], "package.json")).version;
const index = read(join(registry, "registry.json"));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

rmSync(join(out, "r"), { recursive: true, force: true });
for (const variant of ["radix", "base"]) {
  mkdirSync(join(out, "r", variant), { recursive: true });
  const items = index.items.map((item) => ({
    ...item,
    dependencies: item.dependencies.map((d) => `${d}@${version(d)}`),
    files: item.files.map((f) => ({
      ...f,
      path: f.path.replace(/^registry\/radix\//, `registry/${variant}/`),
    })),
  }));
  write(join(out, "r", variant, "registry.json"), { ...index, items });
  for (const item of items) {
    const resolved = {
      $schema: "https://ui.shadcn.com/schema/registry-item.json",
      ...item,
      files: item.files.map((f) => ({
        ...f,
        content: readFileSync(join(registry, f.path), "utf8"),
      })),
    };
    write(join(out, "r", variant, `${item.name}.json`), resolved);
    if (variant === "radix") write(join(out, "r", `${item.name}.json`), resolved);
  }
}
console.log(`Registry built: ${index.items.length} blocks for radix and base in ${out}/r`);
