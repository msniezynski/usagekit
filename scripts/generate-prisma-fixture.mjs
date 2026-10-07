import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./lib/git.mjs";

/** Test-only generated client has no host schema or application models. */
export function generatePrismaFixture() {
  const directory = resolve("node_modules/.cache/usagekit-prisma-fixture");
  const output = resolve(directory, "client");
  mkdirSync(directory, { recursive: true });
  const schema = resolve(directory, "schema.prisma");
  writeFileSync(
    schema,
    `generator client {
  provider = "prisma-client"
  output = ${JSON.stringify(output)}
  moduleFormat = "esm"
}
datasource db {
  provider = "postgresql"
}
model DriverFixtureMarker {
  id String @id
  @@map("host_marker")
}
`,
  );
  run(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--schema", schema], {
    stdio: "inherit",
  });
}
