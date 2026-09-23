import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePackFiles, validateReleaseIdentity } from "../lib/release.mjs";

test("release requires reviewed main and its annotated version tag", () => {
  const valid = { branch: "main", head: "a", tagCommit: "a", tagType: "tag" };
  validateReleaseIdentity(valid);
  for (const change of [{ branch: "feat/example" }, { tagCommit: "b" }, { tagType: "commit" }])
    assert.throws(() => validateReleaseIdentity({ ...valid, ...change }));
});
test("tarball audit rejects source, test files, maps, missing notices and private terms", () => {
  const files = ["package.json", "LICENSE", "NOTICE", "dist/index.js", "dist/index.d.ts"];
  validatePackFiles(files, []);
  for (const path of [
    "src/index.ts",
    "dist/a.test.js",
    "dist/index.js.map",
    ".env",
    "dist/privateword.js",
  ])
    assert.throws(() => validatePackFiles([...files, path], ["privateword"]));
  assert.throws(() =>
    validatePackFiles(
      files.filter((f) => f !== "NOTICE"),
      [],
    ),
  );
  assert.throws(() => validatePackFiles(files, [], true));
  validatePackFiles(
    [...files, "dist/conformance/index.js", "dist/conformance/index.d.ts"],
    [],
    true,
  );
});
