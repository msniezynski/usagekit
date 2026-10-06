import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vitest/config";

/**
 * Registry consumer tests import blocks from host copies whose "@/" alias points at the host
 * root: the nearest directory with a components.json above the importing file.
 */
const hostAlias: Plugin = {
  name: "usagekit-host-alias",
  enforce: "pre",
  resolveId(source, importer) {
    if (!source.startsWith("@/") || !importer) return null;
    let dir = dirname(importer);
    while (!existsSync(join(dir, "components.json"))) {
      if (dirname(dir) === dir) return null;
      dir = dirname(dir);
    }
    const base = join(dir, source.slice(2));
    const file = [".tsx", ".ts", "/index.tsx", "/index.ts", ""]
      .map((ext) => base + ext)
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    return file ?? null;
  },
};

const names = JSON.parse(
  readFileSync(new URL("./usagekit.workspace.json", import.meta.url), "utf8"),
).projects.map((p: { path: string }) => p.path.split("/")[1]);
export default defineConfig({
  test: {
    reporters: ["default"],
    environment: "node",
    silent: false,
    include: ["packages/*/src/**/*.test.ts", "packages/*/conformance/**/*.test.ts"],
    projects: names.map((name: string) => ({
      extends: false,
      plugins: ["registry", "server"].includes(name) ? [hostAlias] : [],
      resolve: {
        alias: [
          {
            find: "@usagekit/store/reference",
            replacement: new URL("./packages/store/src/reference.ts", import.meta.url).pathname,
          },
          {
            find: "@usagekit/store/conformance",
            replacement: new URL("./packages/store/conformance/index.ts", import.meta.url).pathname,
          },
          ...names.map((name: string) => ({
            find: `@usagekit/${name}`,
            replacement: new URL(`./packages/${name}/src/index.ts`, import.meta.url).pathname,
          })),
        ],
      },
      test: {
        name,
        silent: false,
        exclude: ["packages/store/conformance/!(memory.conformance).test.ts"],
        testTimeout: 60000,
        hookTimeout: 60000,
        environment: ["react", "registry"].includes(name) ? "jsdom" : "node",
        include: [
          `packages/${name}/src/**/*.test.ts`,
          `packages/${name}/conformance/**/*.test.ts`,
          ...(name === "store-d1" ? ["examples/cloudflare-worker/cloudflare.test.ts"] : []),
        ],
      },
    })),
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/store/src/memory/**/*.ts",
        "packages/meter/src/**/*.ts",
        "packages/core/src/providers.ts",
        ...["store-sqlite", "http", "client", "server", "views", "react", "providers", "proxy"].map(
          (name) => `packages/${name}/src/**/*.ts`,
        ),
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: {
        lines: 85,
        ...Object.fromEntries(
          ["store-sqlite", "http", "client", "server", "views", "react", "providers", "proxy"].map(
            (name) => [`packages/${name}/src/**`, { lines: 85 }],
          ),
        ),
        "packages/store/src/memory/**": { lines: 90 },
        "packages/meter/src/**": { lines: 90 },
        "packages/core/src/providers.ts": { lines: 85 },
      },
    },
  },
});
