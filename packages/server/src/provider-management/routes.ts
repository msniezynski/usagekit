import type { Hono } from "hono";
import { hashToken } from "../config.js";
import type { createAuth } from "../auth.js";
import type { createProviderManagement } from "./service.js";
import { fields, parseCommand, parseQuery, parseSecrets } from "./input.js";

export function providerManagementRoutes(
  app: Hono,
  management: ReturnType<typeof createProviderManagement>,
  auth: ReturnType<typeof createAuth>,
) {
  app.get("/providers/management/binding", async (c) => {
    const verified = await auth.authenticate(c.req.raw);
    if (!verified || verified.namespace !== "local") return c.json({ outcome: "forbidden" }, 403);
    return c.json({
      scopeKey: management.scopeKey,
      principalKey: "local",
      authRevision: hashToken(c.req.header("Authorization")!),
      canManage: verified.canManageBudgets === true,
    });
  });
  app.post("/providers/management/read", async (c) => {
    const verified = await auth.authenticate(c.req.raw);
    if (!verified || verified.namespace !== "local") return c.json({ outcome: "forbidden" }, 403);
    const raw: unknown = await c.req.json().catch(() => null);
    const query = fields(raw, ["query"]) ? parseQuery(raw.query) : null;
    return query
      ? c.json(management.read(query))
      : c.json({ outcome: "invalid", field: "query", reason: "Invalid provider query" }, 400);
  });
  for (const route of ["commands", "reconcile"] as const)
    app.post(`/providers/management/${route}`, async (c) => {
      const verified = await auth.authenticate(c.req.raw);
      if (!verified || verified.namespace !== "local" || verified.canManageBudgets !== true)
        return c.json({ outcome: "forbidden" }, 403);
      const raw: unknown = await c.req.json().catch(() => null);
      const command = fields(raw, route === "commands" ? ["command", "secrets"] : ["command"])
        ? parseCommand(raw.command)
        : null;
      if (!command)
        return c.json(
          { outcome: "invalid", field: "command", reason: "Invalid content-free provider command" },
          400,
        );
      if (route === "reconcile") return c.json(management.reconcile(command));
      const secrets = parseSecrets((raw as Record<string, unknown>).secrets);
      if (secrets === null)
        return c.json(
          {
            commandId: command.commandId,
            outcome: "invalid",
            field: "secrets",
            reason: "Invalid credential fields",
          },
          400,
        );
      try {
        return c.json(management.execute(command, secrets));
      } finally {
        if (secrets) for (const key of Object.keys(secrets)) delete secrets[key];
      }
    });
}
