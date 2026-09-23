import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, linkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { encode, decode } from "./output.js";
import { UsageError } from "./context.js";
/** Persist exactly the command being sent. Retrying never invents a new receipt time or version. */
export async function journal<T>(
  dir: string,
  identity: string,
  semantic: unknown,
  build: () => Promise<T>,
): Promise<T> {
  const folder = join(dir, "requests"),
    path = join(folder, createHash("sha256").update(identity).digest("hex") + ".json");
  const fingerprint = encode(semantic);
  const read = () => {
    const row = decode<{ fingerprint: string; payload: T }>(readFileSync(path, "utf8"));
    if (row.fingerprint !== fingerprint) throw new UsageError();
    return row.payload;
  };
  if (existsSync(path)) return read();
  const payload = await build();
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temp = join(folder, crypto.randomUUID() + ".tmp");
  writeFileSync(temp, encode({ fingerprint, payload }), { mode: 0o600, flag: "wx" });
  try {
    try {
      linkSync(temp, path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  } finally {
    unlinkSync(temp);
  }
  return read();
}
