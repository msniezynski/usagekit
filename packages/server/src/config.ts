import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
export const defaultConfigDir = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "usagekit");
export function writePrivate(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, data, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type Config = { version: 1; tokenHash: string };
export function loadConfig(dir = defaultConfigDir()): {
  config: Config;
  path: string;
  firstToken?: string;
} {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "config.json");
  if (existsSync(path)) {
    let config: Config;
    try {
      config = JSON.parse(readFileSync(path, "utf8")) as Config;
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("InvalidConfig");
      throw error;
    }
    if (!config || config.version !== 1 || !/^[0-9a-f]{64}$/.test(config.tokenHash))
      throw new Error("InvalidConfig");
    chmodSync(path, 0o600);
    return { config, path };
  }
  const firstToken = randomBytes(32).toString("base64url"),
    config: Config = { version: 1, tokenHash: hashToken(firstToken) };
  writePrivate(path, JSON.stringify(config));
  return { config, path, firstToken };
}
