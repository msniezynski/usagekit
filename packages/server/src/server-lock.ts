import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type Owner = { pid: number; nonce: string };
export class ServerOwnershipError extends Error {
  readonly code: "server_already_running" | "server_lock_uncertain";
  constructor(kind: "ServerAlreadyRunning" | "ServerLockUncertain") {
    super(kind);
    this.name = "ServerOwnershipError";
    this.code =
      kind === "ServerAlreadyRunning" ? "server_already_running" : "server_lock_uncertain";
  }
}
const live = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};
function owner(path: string): Owner {
  try {
    const value = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as Owner;
    if (
      Number.isSafeInteger(value.pid) &&
      value.pid > 0 &&
      value.pid <= 2147483647 &&
      typeof value.nonce === "string" &&
      /^[a-f0-9-]{36}$/.test(value.nonce)
    )
      return value;
  } catch {
    /* Incomplete or unverified ownership never grants removal. */
  }
  throw new ServerOwnershipError("ServerLockUncertain");
}
const sameDirectory = (path: string, original: { dev: number; ino: number }) => {
  try {
    const current = statSync(path);
    return current.dev === original.dev && current.ino === original.ino;
  } catch {
    return false;
  }
};

/** One live server owns a vault. PID reuse, malformed locks and interrupted recovery fail closed. */
export function acquireServerLock(configDir: string): () => void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const dir = realpathSync(configDir),
    path = join(dir, ".server-lock"),
    nonce = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const previous = owner(path),
        original = statSync(path);
      if (live(previous.pid)) throw new ServerOwnershipError("ServerAlreadyRunning");
      const recovery = join(path, "recovery.json"),
        claim = JSON.stringify({ pid: process.pid, nonce });
      // All stale removers contend inside the original directory. A new directory has another inode.
      try {
        writeFileSync(recovery, claim, { flag: "wx", mode: 0o600 });
      } catch {
        throw new ServerOwnershipError("ServerLockUncertain");
      }
      try {
        if (
          !sameDirectory(path, original) ||
          owner(path).nonce !== previous.nonce ||
          live(previous.pid)
        )
          throw new ServerOwnershipError("ServerLockUncertain");
        const retained = join(dir, `.server-lock.stale-${nonce}`);
        renameSync(path, retained);
        rmSync(retained, { recursive: true });
      } finally {
        if (sameDirectory(path, original) && readFileSync(recovery, "utf8") === claim)
          unlinkSync(recovery);
      }
      continue;
    }
    const original = statSync(path);
    try {
      writeFileSync(join(path, "owner.json"), JSON.stringify({ pid: process.pid, nonce }), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (sameDirectory(path, original)) rmSync(path, { recursive: true });
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (sameDirectory(path, original) && owner(path).nonce === nonce)
        rmSync(path, { recursive: true });
    };
  }
  throw new ServerOwnershipError("ServerLockUncertain");
}
