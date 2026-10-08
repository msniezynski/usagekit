import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("unit tests exclude database fixtures even when the caller supplies a database URL", () => {
  const result = spawnSync(
    "npm",
    [
      "run",
      "test:unit",
      "--",
      "packages/store-postgres/src/prisma.postgres.test.ts",
      "--passWithNoTests",
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        USAGEKIT_POSTGRES_TEST_URL: "postgresql://fixture@127.0.0.1:1/unreachable",
      },
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /No test files found/);
});
