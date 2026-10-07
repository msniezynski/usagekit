import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync } from "node:fs";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
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

test("legacy encrypted entries gain stable random revisions without changing their credentials or public list", () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-vault-legacy-")),
    path = join(dir, "vault.enc");
  const passphrase = "synthetic-legacy-passphrase",
    secret = "synthetic-retained-legacy-key";
  const salt = randomBytes(16),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const entry = { provider: "serpapi", connectionId: "old-connection", secret };
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify([entry]), "utf8"),
    cipher.final(),
  ]);
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      index: [{ provider: entry.provider, connectionId: entry.connectionId }],
    }),
    { mode: 0o600 },
  );
  try {
    const vault = createVault(path);
    expect(vault.describe()[0]?.revision).toBeUndefined();
    vault.unlock(passphrase);
    const revision = vault.describe()[0]!.revision;
    expect(revision).toMatch(/^[a-f0-9-]{36}$/);
    expect(vault.list()).toEqual([{ provider: "serpapi", connectionId: "old-connection" }]);
    vault.lock();
    const restarted = createVault(path);
    expect(restarted.describe()[0]!.revision).toBe(revision);
    restarted.unlock(passphrase);
    expect(restarted.get("serpapi", "old-connection")).toBe(secret);
    expect(restarted.describe()[0]!.revision).toBe(revision);
    expect(readFileSync(path, "utf8")).not.toContain(secret);
    restarted.lock();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
