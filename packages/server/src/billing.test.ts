import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import type { BillingImportInput } from "@usagekit/core";
import { createRemoteMeter } from "@usagekit/client";
import { createManualClock } from "@usagekit/store";
import { dataforseo, parseBillingExport } from "@usagekit/providers";
import { localAccess } from "./auth.js";
import { startServer } from "./index.js";

test("the verified local operator token imports only an existing owned connection and never calls the provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usagekit-server-billing-")),
    clock = createManualClock("2026-09-30T00:00:00.000Z");
  const providerFetch = vi.fn<typeof fetch>(async () => {
    throw new Error("billing must not dispatch");
  });
  let token = "";
  let server = await startServer({
    configDir: dir,
    port: 0,
    clock,
    passphrase: "test-password",
    providerFetch,
    onToken: (value) => {
      token = value;
    },
  });
  try {
    const remote = createRemoteMeter({ baseUrl: server.url, token });
    const history = JSON.parse(
      readFileSync(
        new URL(
          "../../providers/src/dataforseo/fixtures/serp.google.organic.task_get.advanced/resolves-task-post.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const parsed = await parseBillingExport(dataforseo, JSON.stringify(history.response.body));
    const input: BillingImportInput = {
      scope: { namespace: "local", principal: "local", connection: "c" },
      ...parsed,
      window: { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
      expectedPreviousImportId: null,
      attribution: { fundingSource: "byok", costOwner: "local" },
    };
    expect(localAccess.canImportBilling).toBe(true);
    expect(await remote.importBilling({ ...localAccess, canImportBilling: false }, input)).toEqual({
      outcome: "forbidden",
    });
    server.vault.put("dataforseo", "c", "vault-test-secret");
    const imported = await remote.importBilling({ ...localAccess, canImportBilling: false }, input);
    expect(imported).toMatchObject({ outcome: "imported", replayed: false });
    if (imported.outcome !== "imported") throw new Error("operator import fixture");
    const operationId = imported.record.unobservedOperationIds[0]!;
    const operation = await remote.getOperation(localAccess, {
      namespace: "local",
      principal: "local",
      operationId,
    });
    expect(operation).toMatchObject({
      outcome: "ok",
      value: { state: "pending", source: "import", lease: null },
    });
    if (operation.outcome !== "ok" || !operation.value)
      throw new Error("operator operation fixture");
    expect(operation.value.receipts[0]?.cost).toEqual({
      certainty: "measured",
      money: { units: 1200n, currency: "USD" },
    });
    expect(
      await remote.markDispatchIntent({
        namespace: "local",
        principal: "local",
        operationId,
        commandId: "attempt-dispatch",
        expectedVersion: operation.value.version,
        holder: "h",
        leaseTtlMs: 1000,
      }),
    ).toMatchObject({ granted: false });
    expect(await remote.importBilling(localAccess, input)).toMatchObject({
      outcome: "imported",
      replayed: true,
    });
    expect(
      await remote.billingImports(localAccess, {
        scope: { namespace: "local", principal: "local" },
        connection: "c",
        ...input.window,
      }),
    ).toMatchObject({ outcome: "ok", value: { records: [{ fileHash: input.fileHash }] } });
    expect(
      await remote.importBilling(localAccess, {
        ...input,
        provider: "serpapi",
        fileHash: "b".repeat(64),
      }),
    ).toEqual({ outcome: "forbidden" });
    const unauthorized = createRemoteMeter({ baseUrl: server.url, token: "wrong-token" });
    await expect(
      unauthorized.importBilling({ ...localAccess, canImportBilling: true }, input),
    ).rejects.toMatchObject({ name: "RemoteHttpError", status: 401 });
    await server.stop();
    server = await startServer({
      configDir: dir,
      port: 0,
      clock,
      passphrase: "test-password",
      providerFetch,
      onToken: () => {},
    });
    const restarted = createRemoteMeter({ baseUrl: server.url, token });
    expect(await restarted.importBilling(localAccess, input)).toMatchObject({
      outcome: "imported",
      replayed: true,
      record: { id: imported.record.id },
    });
    expect(
      await restarted.billingImports(localAccess, {
        scope: { namespace: "local", principal: "local" },
        connection: "c",
        ...input.window,
      }),
    ).toMatchObject({ outcome: "ok", value: { records: [{ id: imported.record.id }] } });
    await server.stop();
    server = await startServer({
      configDir: dir,
      port: 0,
      clock,
      passphrase: "test-password",
      providerFetch,
      enabledProviders: [],
      onToken: () => {},
    });
    const disabled = createRemoteMeter({ baseUrl: server.url, token });
    expect(
      await disabled.importBilling(localAccess, {
        ...input,
        fileHash: "b".repeat(64),
        expectedPreviousImportId: imported.record.id,
      }),
    ).toEqual({ outcome: "forbidden" });
    expect(providerFetch).not.toHaveBeenCalled();
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
