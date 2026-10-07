import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProviderBinding, ProviderCommand, ProviderManagementPort } from "@usagekit/views";
import { startServer } from "./index.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const directory = () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-ui-client-"));
  dirs.push(dir);
  return dir;
};
const client = async () =>
  (await import(
    /* @vite-ignore */ pathToFileURL(join(import.meta.dirname, "../ui/app/management-client.ts"))
      .href
  )) as {
    loadProviderBinding(session: {
      baseUrl: string;
      token: string;
      fetch: typeof globalThis.fetch;
    }): Promise<ProviderBinding>;
    createProviderPort(session: {
      baseUrl: string;
      token: string;
      fetch: typeof globalThis.fetch;
    }): ProviderManagementPort;
  };

test("the browser port reconciles a lost connection response using the original command without credentials or another provider call", async () => {
  let token = "";
  const providerFetch = vi.fn<typeof fetch>();
  const server = await startServer({
    configDir: directory(),
    port: 0,
    passphrase: "disposable-test-passphrase",
    providerFetch,
    onToken: (value) => (token = value),
  });
  const seen: { path: string; body: string; authorization: string | null }[] = [];
  let drop = true;
  const transport: typeof fetch = async (url, init) => {
    const request = new Request(String(url), init);
    const path = new URL(request.url).pathname;
    seen.push({
      path,
      body: await request.clone().text(),
      authorization: request.headers.get("Authorization"),
    });
    const response = await server.app.request(request);
    if (path.endsWith("/commands") && drop) {
      drop = false;
      throw new Error("do-not-echo-secret");
    }
    return response;
  };
  const session = { baseUrl: "http://local.test", token, fetch: transport };
  const { loadProviderBinding, createProviderPort } = await client();
  const port = createProviderPort(session);
  const command: ProviderCommand = {
    kind: "connect",
    commandId: "client-lost-response",
    provider: "serpapi",
    fundingSource: "byok",
  };
  try {
    const binding = await loadProviderBinding(session);
    expect(binding).toMatchObject({ canManage: true, principalKey: "local" });
    const secrets = { secret: "provider-key-marker" };
    const answer = await port.execute(binding, command, secrets);
    expect(answer).toMatchObject({
      outcome: "unavailable",
      ambiguous: true,
      commandId: command.commandId,
    });
    expect(JSON.stringify(answer)).not.toContain("do-not-echo-secret");
    const reconciled = await port.reconcile!(binding, command);
    expect(reconciled).toMatchObject({ outcome: "success", connection: { provider: "serpapi" } });
    expect(JSON.stringify(reconciled)).not.toContain(secrets.secret);
    expect(seen.filter((item) => item.path.endsWith("/commands"))).toHaveLength(1);
    expect(seen.find((item) => item.path.endsWith("/reconcile"))?.body).toBe(
      JSON.stringify({ command }),
    );
    expect(seen.every((item) => item.authorization === `Bearer ${token}`)).toBe(true);
    expect(server.vault.list()).toHaveLength(1);
    expect(providerFetch).not.toHaveBeenCalled();
  } finally {
    await server.stop();
  }
});

test("malformed server bindings cannot enable management and definite validation failures use neutral feedback", async () => {
  const { loadProviderBinding, createProviderPort } = await client();
  const session = {
    baseUrl: "http://local.test",
    token: "disposable-token",
    fetch: vi.fn<typeof fetch>(),
  };
  session.fetch.mockResolvedValueOnce(Response.json({ canManage: true }));
  await expect(loadProviderBinding(session)).rejects.toThrow("Could not verify");
  const binding = { scopeKey: "fake", principalKey: "local", authRevision: "1", canManage: true };
  const command: ProviderCommand = {
    kind: "test",
    commandId: "invalid",
    provider: "serpapi",
    fundingSource: "byok",
  };
  session.fetch.mockResolvedValueOnce(
    Response.json({ outcome: "invalid", reason: "secret-marker" }, { status: 400 }),
  );
  expect(await createProviderPort(session).execute(binding, command)).toEqual({
    commandId: "invalid",
    outcome: "invalid",
    field: "command",
    reason: "The local server rejected the command before applying it.",
  });
});
