import { expect, test, vi } from "vitest";
import { vaultPassphrase, startupError } from "./startup.js";
import { createVault } from "./vault.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("first interactive vault creation confirms; mismatch fails before writing", async () => {
  const prompt = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("typo");
  await expect(vaultPassphrase({ exists: false, prompt })).rejects.toThrow(
    "PassphraseConfirmationMismatch",
  );
  expect(prompt).toHaveBeenCalledTimes(2);
  const same = vi.fn().mockResolvedValue("same");
  expect(await vaultPassphrase({ exists: false, prompt: same })).toBe("same");
  expect(same).toHaveBeenCalledTimes(2);
  const existing = vi.fn().mockResolvedValue("existing");
  expect(await vaultPassphrase({ exists: true, prompt: existing })).toBe("existing");
  expect(existing).toHaveBeenCalledTimes(1);
  expect(await vaultPassphrase({ exists: false, prompt: vi.fn().mockResolvedValue("") })).toBe("");
});
test("startup errors distinguish port, config and vault without leaking raw messages", () => {
  expect(startupError(Object.assign(new Error("sensitive"), { code: "EADDRINUSE" }))).toMatchObject(
    { code: "port_in_use" },
  );
  expect(startupError(new Error("InvalidConfig"))).toMatchObject({ code: "invalid_config" });
  expect(startupError(new Error("VaultUnlockFailed"))).toMatchObject({
    code: "vault_unlock_failed",
  });
  expect(startupError(new Error("arbitrary sensitive detail")).message).not.toContain("sensitive");
});
test("connection id cannot silently move to another provider", () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-vault-identity-")),
    vault = createVault(join(dir, "vault.enc")),
    secret = crypto.randomUUID();
  try {
    vault.unlock(crypto.randomUUID());
    vault.put("first", "c", secret);
    expect(() => vault.put("second", "c", crypto.randomUUID())).toThrow(
      "ConnectionProviderMismatch",
    );
    expect(vault.get("first", "c")).toBe(secret);
    expect(vault.list()).toEqual([{ provider: "first", connectionId: "c" }]);
  } finally {
    vault.lock();
    rmSync(dir, { recursive: true, force: true });
  }
});
