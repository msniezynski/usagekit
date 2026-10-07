import { afterEach, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./index.js";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-server-owner-"));
  dirs.push(dir);
  return dir;
};
test("a second instance on another port cannot own the same vault or accept a stale connection revision", async () => {
  const dir = directory(),
    options = {
      configDir: dir,
      port: 0,
      passphrase: "synthetic-owner-passphrase",
      onToken: () => {},
    };
  const first = await startServer(options);
  let second: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    first.vault.put("serpapi", "connection", "synthetic-initial-key");
    const revision = first.vault.describe()[0]!.revision;
    try {
      second = await startServer(options);
    } catch (error) {
      expect((error as Error).message).toBe("ServerAlreadyRunning");
    }
    expect(second).toBeUndefined();
    first.vault.put("serpapi", "connection", "synthetic-rotated-key");
    expect(first.vault.describe()[0]!.revision).not.toBe(revision);
    expect(statSync(join(dir, ".server-lock")).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, ".server-lock", "owner.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, ".server-lock", "owner.json"), "utf8")).not.toContain(
      "synthetic",
    );
  } finally {
    await second?.stop();
    await first.stop();
  }
  const restarted = await startServer(options);
  try {
    expect(restarted.vault.get("serpapi", "connection")).toBe("synthetic-rotated-key");
  } finally {
    await restarted.stop();
  }
  expect(existsSync(join(dir, ".server-lock"))).toBe(false);
});

test("startup failures release ownership and a proved crashed-process lock is recovered without touching live locks", async () => {
  const dir = directory();
  writeFileSync(join(dir, "config.json"), "invalid synthetic config", { mode: 0o600 });
  await expect(startServer({ configDir: dir, port: 0 })).rejects.toThrow("InvalidConfig");
  expect(existsSync(join(dir, ".server-lock"))).toBe(false);
  rmSync(join(dir, "config.json"));
  const crashed = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  expect(crashed.status).toBe(0);
  mkdirSync(join(dir, ".server-lock"), { mode: 0o700 });
  writeFileSync(
    join(dir, ".server-lock", "owner.json"),
    JSON.stringify({ pid: crashed.pid, nonce: crypto.randomUUID() }),
    { mode: 0o600 },
  );
  const server = await startServer({
    configDir: dir,
    port: 0,
    passphrase: "synthetic-owner-passphrase",
    onToken: () => {},
  });
  try {
    const owner = readFileSync(join(dir, ".server-lock", "owner.json"), "utf8");
    await expect(startServer({ configDir: dir, port: 0 })).rejects.toThrow("ServerAlreadyRunning");
    expect(readFileSync(join(dir, ".server-lock", "owner.json"), "utf8")).toBe(owner);
  } finally {
    await server.stop();
  }
  await expect(
    startServer({ configDir: dir, port: 0, passphrase: "wrong synthetic passphrase" }),
  ).rejects.toThrow("VaultUnlockFailed");
  expect(existsSync(join(dir, ".server-lock"))).toBe(false);
  const restarted = await startServer({
    configDir: dir,
    port: 0,
    passphrase: "synthetic-owner-passphrase",
  });
  await restarted.stop();
});

test("malformed and interrupted-recovery locks fail closed rather than being removed", async () => {
  const dir = directory(),
    lock = join(dir, ".server-lock");
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(join(lock, "owner.json"), "malformed ownership", { mode: 0o600 });
  await expect(startServer({ configDir: dir, port: 0 })).rejects.toThrow("ServerLockUncertain");
  expect(readFileSync(join(lock, "owner.json"), "utf8")).toBe("malformed ownership");
  const crashed = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  expect(crashed.status).toBe(0);
  writeFileSync(
    join(lock, "owner.json"),
    JSON.stringify({ pid: crashed.pid, nonce: crypto.randomUUID() }),
  );
  writeFileSync(join(lock, "recovery.json"), "incomplete recovery");
  await expect(startServer({ configDir: dir, port: 0 })).rejects.toThrow("ServerLockUncertain");
  expect(readFileSync(join(lock, "recovery.json"), "utf8")).toBe("incomplete recovery");
  expect(existsSync(join(dir, "config.json"))).toBe(false);
});
