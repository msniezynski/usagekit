import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Prepare only ignored local showcases. No installation, registry traffic or publication.
const consumers = dirname(fileURLToPath(import.meta.url));
const registry = resolve(consumers, "..");
const repo = resolve(registry, "../..");
const work = join(registry, ".work/showcase");
const output = join(work, "registry");
mkdirSync(work, { recursive: true });
execFileSync(process.execPath, [join(repo, "scripts/registry-build.mjs"), "--out", output], {
  cwd: repo,
  stdio: "pipe",
});
for (const [variant, port] of [
  ["radix", 5177],
  ["base", 5178],
]) {
  const host = join(work, variant);
  rmSync(host, { recursive: true, force: true });
  cpSync(join(consumers, variant), host, { recursive: true });
  symlinkSync(join(repo, "node_modules"), join(host, "node_modules"), "dir");
  const index = JSON.parse(readFileSync(join(output, "r", variant, "registry.json"), "utf8"));
  const copied = new Map();
  for (const { name } of index.items) {
    const artifact = JSON.parse(readFileSync(join(output, "r", variant, `${name}.json`), "utf8"));
    for (const file of artifact.files) {
      if (!/^@components\/usagekit\/[a-z-]+\.tsx$/.test(file.target))
        throw Error("Invalid copied target");
      const target = join(host, file.target.replace(/^@/, ""));
      if (copied.has(target) && copied.get(target) !== file.content)
        throw Error("Conflicting bundled dependency");
      copied.set(target, file.content);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
  }
  const aliases = Object.fromEntries(
    ["core", "store", "meter", "views", "react"].map((name) => [
      `@usagekit/${name}`,
      join(repo, "packages", name, "src/index.ts"),
    ]),
  );
  aliases["@"] = host;
  writeFileSync(
    join(host, "vite.config.ts"),
    `import tailwindcss from "@tailwindcss/vite";\nimport { defineConfig } from "vite";\nexport default defineConfig({ plugins: [tailwindcss()], resolve: { alias: ${JSON.stringify(aliases)} } });\n`,
  );
  if (!existsSync(join(repo, "node_modules/vite/bin/vite.js")))
    throw Error("Run the root npm ci first");
  console.log(`${variant}: ${copied.size} copied components, http://127.0.0.1:${port}`);
  console.log(
    `${process.execPath} ${join(repo, "node_modules/vite/bin/vite.js")} ${host} --config ${join(host, "vite.config.ts")} --host 127.0.0.1 --port ${port} --strictPort`,
  );
}
