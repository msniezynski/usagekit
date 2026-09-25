import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Ajv } from "ajv";
import { blockNames, variantSpecific, variants } from "./index.js";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "../..");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const version = (name: string) => read(join(repo, "packages", name, "package.json")).version;
const primitives = ["table", "card", "badge", "tooltip", "select", "button"];
let out: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "usagekit-registry-"));
  execFileSync(process.execPath, [join(repo, "scripts/registry-build.mjs"), "--out", out], {
    cwd: repo,
    stdio: "pipe",
  });
});
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("registry build", () => {
  test("writes seven defaults and one directory per variant", () => {
    expect(readdirSync(join(out, "r")).sort()).toEqual(
      [...blockNames.map((n) => `${n}.json`), "base", "radix"].sort(),
    );
    for (const variant of variants)
      expect(readdirSync(join(out, "r", variant)).sort()).toEqual(
        [...blockNames.map((n) => `${n}.json`), "registry.json"].sort(),
      );
    for (const name of blockNames)
      expect(read(join(out, "r", `${name}.json`))).toEqual(
        read(join(out, "r", "radix", `${name}.json`)),
      );
  });
  test("every output validates against the vendored shadcn schemas", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    // The vendored files name the https draft-07 meta-schema, which Ajv registers under http.
    const schema = (file: string) => {
      const { $schema: _, ...rest } = read(join(root, "schema", file));
      return rest;
    };
    const itemSchema = schema("registry-item.json");
    ajv.addSchema(itemSchema, "https://ui.shadcn.com/schema/registry-item.json");
    const item = ajv.getSchema("https://ui.shadcn.com/schema/registry-item.json")!;
    const index = ajv.compile(schema("registry.json"));
    expect(index(read(join(root, "registry.json"))), JSON.stringify(index.errors)).toBe(true);
    for (const variant of variants) {
      expect(index(read(join(out, "r", variant, "registry.json")))).toBe(true);
      for (const name of blockNames) {
        const data = read(join(out, "r", variant, `${name}.json`));
        expect(item(data), `${variant}/${name} ${JSON.stringify(item.errors)}`).toBe(true);
      }
    }
  });
  test("items are blocks with host primitives, pinned usagekit dependencies and docs", () => {
    const pins = ["react", "views", "core"].map((n) => `@usagekit/${n}@${version(n)}`);
    for (const variant of variants)
      for (const name of blockNames) {
        const data = read(join(out, "r", variant, `${name}.json`));
        expect(data).toMatchObject({ name, type: "registry:block" });
        expect(data.dependencies).toEqual(pins);
        expect(data.registryDependencies.length).toBeGreaterThan(0);
        for (const dep of data.registryDependencies) {
          expect(primitives).toContain(dep);
          expect(data.docs).toContain(`@/components/ui/${dep}`);
        }
        for (const file of data.files) {
          expect(file.type).toBe("registry:component");
          expect(file.target).toMatch(/^@components\/usagekit\/[a-z-]+\.tsx$/);
          expect(file.path).toBe(`registry/${variant}/${name}/${name}.tsx`);
          expect(file.content).toBe(readFileSync(join(root, file.path), "utf8"));
        }
      }
  });
});

describe("registry sources", () => {
  const sources = variants.flatMap((variant) =>
    blockNames.map((name) => ({
      variant,
      name,
      path: join(root, "registry", variant, name, `${name}.tsx`),
    })),
  );
  test("identical files are shared; only primitive API differences are variant files", () => {
    for (const name of blockNames) {
      const base = join(root, "registry", "base", name, `${name}.tsx`);
      const radix = join(root, "registry", "radix", name, `${name}.tsx`);
      expect(existsSync(base) && existsSync(radix)).toBe(true);
      if (variantSpecific.includes(name)) {
        expect(lstatSync(base).isSymbolicLink()).toBe(false);
        expect(readFileSync(base, "utf8")).not.toBe(readFileSync(radix, "utf8"));
      } else {
        expect(lstatSync(base).isSymbolicLink()).toBe(true);
        expect(readFileSync(base, "utf8")).toBe(readFileSync(radix, "utf8"));
      }
    }
  });
  test("imports go through host primitives and usagekit packages only", () => {
    const index = read(join(root, "registry.json")).items as {
      name: string;
      registryDependencies: string[];
    }[];
    for (const { name, path } of sources) {
      const text = readFileSync(path, "utf8");
      expect(text).not.toMatch(/@radix-ui|@base-ui|from "radix-ui"/);
      const deps = index.find((i) => i.name === name)!.registryDependencies;
      const specifiers = [...text.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const s of specifiers) {
        const ui = /^@\/components\/ui\/([a-z-]+)$/.exec(s);
        if (ui) expect(deps).toContain(ui[1]);
        else expect(s).toMatch(/^(react|@usagekit\/(core|views|react))$/);
      }
      for (const dep of deps) expect(specifiers).toContain(`@/components/ui/${dep}`);
    }
  });
  test("styling uses semantic tokens only and ships no CSS", () => {
    const palette =
      /\b(bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\d+)?\b/;
    for (const { path } of sources) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(palette);
      expect(text, path).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
      expect(text, path).not.toMatch(/\bNumber\(/);
    }
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      );
    expect(files(join(root, "registry")).filter((f) => !f.endsWith(".tsx"))).toEqual([]);
  });
  test("copy is host text with English defaults", () => {
    for (const { path } of sources)
      expect(readFileSync(path, "utf8")).toMatch(/labels\?: Partial</);
  });
});
