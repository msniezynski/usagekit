import { describe, expect, test } from "vitest";
import { validateDescriptor } from "@usagekit/core";
import type { ProviderDescriptor } from "@usagekit/core";
import type { Extractors } from "../types.js";
import { createCatalog } from "../catalog.js";
import { loadFixtures, missingFixtures, verifyFixture } from "../fixtures.js";
import type { FixtureDirectory } from "../fixtures.js";

/**
 * Contract tests for one descriptor: it validates, every advertised operation has at least one
 * fixture, and every fixture matches its operation and yields the expected receipt or parsed
 * value. fixturesDir maps each fixture path to its parsed JSON, for example
 * `import.meta.glob("./fixtures/**\/*.json", { eager: true, import: "default" })`, because web
 * runtime packages cannot read directories.
 */
export function runDescriptorConformance(
  descriptor: ProviderDescriptor,
  extractors: Extractors,
  fixturesDir: FixtureDirectory,
) {
  describe(`descriptor ${descriptor.id}`, () => {
    const fixtures = loadFixtures(fixturesDir);
    const catalog = createCatalog({
      providers: [{ descriptor, extractors }],
      enabled: [descriptor.id],
    });
    test("validates without problems", () => {
      expect(validateDescriptor(descriptor)).toEqual([]);
    });
    test("every advertised operation has a fixture", () => {
      expect(missingFixtures(descriptor, fixtures)).toEqual([]);
    });
    test("every fixture belongs to this descriptor", () => {
      expect(fixtures.filter((f) => f.provider !== descriptor.id).map((f) => f.path)).toEqual([]);
    });
    for (const fixture of fixtures)
      test(`fixture ${fixture.operation}/${fixture.path.split("/").at(-1)}`, () => {
        expect(verifyFixture(catalog, fixture)).toEqual([]);
      });
  });
}
