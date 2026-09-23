import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { git } from "./lib/git.mjs";
import { publishable } from "./lib/release.mjs";

const file = resolve(git(["rev-parse", "--git-path", "usagekit/release.json"]));
const context = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
const name = process.env.npm_package_name;
if (
  !context ||
  !publishable.includes(name) ||
  context.expiresAt < Date.now() ||
  context.nonce !== process.env.USAGEKIT_RELEASE_NONCE ||
  context.head !== git(["rev-parse", "HEAD"]) ||
  git(["branch", "--show-current"]) !== "main"
)
  throw new Error("Publish only through npm run release on reviewed, signed main.");
