import { existsSync, copyFileSync, mkdirSync } from "node:fs";
const source = "packages/store-sqlite/src/schema.sql";
if (existsSync(source)) {
  mkdirSync("packages/store-sqlite/dist", { recursive: true });
  copyFileSync(source, "packages/store-sqlite/dist/schema.sql");
}
