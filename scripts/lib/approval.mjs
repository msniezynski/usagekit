import { existsSync, readFileSync, rmSync } from "node:fs";

export function clearExpiredApproval(file, now = Date.now()) {
  if (!existsSync(file)) return;
  const { expiresAt } = JSON.parse(readFileSync(file, "utf8"));
  if (!Number.isFinite(expiresAt)) throw new Error(`Invalid approval expiry: ${file}`);
  if (expiresAt < now) {
    rmSync(file);
    return;
  }
  const seconds = Math.ceil((expiresAt - now) / 1000);
  throw new Error(`Another approval is active: ${file} (${seconds} seconds remaining).`);
}
