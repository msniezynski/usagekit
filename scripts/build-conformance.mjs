import { rmSync, cpSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { run } from "./lib/git.mjs";
const temporary = "packages/store/dist-conformance";
rmSync(temporary, { recursive: true, force: true });
try {
  run(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "packages/store/tsconfig.conformance.json"],
    { stdio: "inherit" },
  );
  rmSync("packages/store/dist/conformance", { recursive: true, force: true });
  cpSync(`${temporary}/conformance`, "packages/store/dist/conformance", { recursive: true });
  for (const file of readdirSync("packages/store/dist/conformance")) {
    const path = `packages/store/dist/conformance/${file}`;
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("../src/index.js", "../index.js"));
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
