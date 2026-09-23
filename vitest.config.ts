import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

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
        environment: "node",
        include: [`packages/${name}/src/**/*.test.ts`, `packages/${name}/conformance/**/*.test.ts`],
      },
    })),
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "packages/store/src/memory/**/*.ts",
        "packages/meter/src/**/*.ts",
        ...["store-sqlite", "http", "client", "server"].map(
          (name) => `packages/${name}/src/**/*.ts`,
        ),
      ],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 85,
        ...Object.fromEntries(
          ["store-sqlite", "http", "client", "server"].map((name) => [
            `packages/${name}/src/**`,
            { lines: 85 },
          ]),
        ),
        "packages/store/src/memory/**": { lines: 90 },
        "packages/meter/src/**": { lines: 90 },
      },
    },
  },
});
