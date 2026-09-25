import { Hono } from "hono";
import { createUsageHandlers, parseBudget, encodeWire } from "@usagekit/http";
import { normalizeTags } from "@usagekit/core";
import type { Meter } from "@usagekit/core";
import type { SqliteStore } from "@usagekit/store-sqlite";
import type { createAuth } from "./auth.js";
import type { Vault } from "./vault.js";
export function createApp({
  meter,
  store,
  auth,
  vault,
  configPath,
}: {
  meter: Meter;
  store: SqliteStore;
  auth: ReturnType<typeof createAuth>;
  vault: Vault;
  configPath: string;
}) {
  const app = new Hono();
  app.onError((error, c) =>
    c.json(
      {
        error:
          error.message === "VaultLocked"
            ? "vault_locked"
            : error.message === "ConnectionProviderMismatch"
              ? "connection_provider_mismatch"
              : "internal_error",
      },
      error.message === "VaultLocked"
        ? 423
        : error.message === "ConnectionProviderMismatch"
          ? 409
          : 500,
    ),
  );
  app.use("*", async (c, next) => {
    if (c.req.path !== "/health" && !(await auth.authenticate(c.req.raw)))
      return c.json({ outcome: "unauthorized" }, 401);
    await next();
  });
  app.get("/health", (c) =>
    c.json({ ok: true, version: "0.0.0", durable: true, vaultUnlocked: vault.unlocked }),
  );
  const handler = createUsageHandlers({ meter, authenticate: auth.authenticate });
  app.all("/v1/*", (c) => handler(c.req.raw));
  app.get("/providers/connections", (c) => c.json(vault.list()));
  app.post("/providers/connections", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return c.json({ error: "invalid_request" }, 400);
    const b = body as Record<string, unknown>;
    if (
      Object.keys(b).some((k) => !["provider", "connectionId", "secret", "tags"].includes(k)) ||
      ![b.provider, b.connectionId, b.secret].every(
        (x) => typeof x === "string" && x.trim().length > 0,
      )
    )
      return c.json({ error: "invalid_request" }, 400);
    const tags = b.tags === undefined ? undefined : normalizeTags(b.tags as readonly string[]);
    if (tags === null) return c.json({ error: "invalid_request" }, 400);
    vault.put(b.provider as string, b.connectionId as string, b.secret as string, tags);
    return c.json({
      provider: b.provider,
      connectionId: b.connectionId,
      ...(tags ? { tags } : {}),
    });
  });
  app.delete("/providers/connections/:id", (c) => {
    vault.remove(c.req.param("id"));
    return c.json({ removed: true });
  });
  app.post("/providers/connections/:id/test", (c) => {
    const entry = vault.list().find((e) => e.connectionId === c.req.param("id"));
    if (!entry) return c.json({ error: "connection_not_found" }, 404);
    const secret = vault.get(entry.provider, entry.connectionId);
    return c.json({
      ...entry,
      valid: secret.trim().length > 0 && !/[\r\n\0]/.test(secret),
      method: "format",
      network: false,
    });
  });
  app.get(
    "/budgets",
    () =>
      new Response(encodeWire(store.listBudgets()), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  app.put("/budgets", async (c) => {
    const access = await auth.authenticate(c.req.raw);
    if (!access?.canManageBudgets) return c.json({ outcome: "forbidden" }, 403);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const b = parseBudget(raw);
    if (!b) return c.json({ error: "invalid_budget" }, 400);
    if (b.scope.namespace !== access.namespace) return c.json({ outcome: "forbidden" }, 403);
    if (b.limit && (b.limit.value < 0n || b.limit.unit !== b.unit))
      return c.json({ error: "invalid_budget" }, 400);
    const saved = store.putBudget(b);
    if (saved.outcome === "invalid") return c.json({ error: "invalid_budget" }, 400);
    if (saved.outcome === "conflict") return c.json(saved, 409);
    return new Response(encodeWire(b), { headers: { "Content-Type": "application/json" } });
  });
  app.get("/token/path", (c) => c.json({ path: configPath }));
  app.post("/token/rotate", (c) => c.json({ token: auth.rotate() }));
  return app;
}
