import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { defaultConfigDir, loadConfig } from "./config.js";
import { serverMain } from "./main.js";
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
test("config defaults and corrupt config fail closed", () => {
  vi.stubEnv("XDG_CONFIG_HOME", "/tmp/example-config");
  expect(defaultConfigDir()).toBe("/tmp/example-config/usagekit");
  vi.stubEnv("XDG_CONFIG_HOME", "");
  expect(defaultConfigDir()).toBe(join(homedir(), ".config", "usagekit"));
  const d = mkdtempSync(join(tmpdir(), "usagekit-config-"));
  dirs.push(d);
  writeFileSync(join(d, "config.json"), JSON.stringify({ version: 9, tokenHash: "bad" }));
  expect(() => loadConfig(d)).toThrow();
});
test("server entry accepts passphrase environment and registers shutdown handlers", async () => {
  const d = mkdtempSync(join(tmpdir(), "usagekit-main-"));
  dirs.push(d);
  vi.stubEnv("USAGEKIT_VAULT_PASSPHRASE", crypto.randomUUID());
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const before = { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };
  const s = await serverMain(["--config-dir", d, "--port", "0", "--host", "127.0.0.1"]);
  try {
    expect(s.vault.unlocked).toBe(true);
    expect(log).toHaveBeenCalledTimes(2);
  } finally {
    await s.stop();
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      for (const fn of process.listeners(signal))
        if (!before[signal].includes(fn)) process.removeListener(signal, fn);
  }
});
