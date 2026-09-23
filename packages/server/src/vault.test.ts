import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVault } from "./vault.js";
test("vault encryption, unlock, metadata and permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-vault-")),
    path = join(dir, "vault.enc"),
    passphrase = crypto.randomUUID(),
    secret = crypto.randomUUID();
  try {
    const vault = createVault(path);
    expect(vault.unlocked).toBe(false);
    expect(() => vault.put("example", "c1", secret)).toThrow("VaultLocked");
    vault.unlock(passphrase);
    vault.put("example", "c1", secret);
    expect(vault.get("example", "c1")).toBe(secret);
    expect(vault.list()).toEqual([{ provider: "example", connectionId: "c1" }]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const before = readFileSync(path, "utf8");
    expect(before).not.toContain(secret);
    vault.put("example", "c1", secret);
    expect(readFileSync(path, "utf8")).not.toEqual(before);
    const next = createVault(path);
    expect(next.list()).toEqual(vault.list());
    expect(() => next.unlock("wrong")).toThrow("VaultUnlockFailed");
    expect(next.unlocked).toBe(false);
    next.unlock(passphrase);
    expect(next.get("example", "c1")).toBe(secret);
    next.remove("c1");
    expect(next.list()).toEqual([]);
    expect(() => next.get("example", "c1")).toThrow("ConnectionNotFound");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
