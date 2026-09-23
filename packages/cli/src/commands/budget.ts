import type { Budget, BudgetScope, BudgetWindow } from "@usagekit/core";
import { type Context, string, quantity, UsageError } from "../context.js";
export function window(o: Context["options"]): BudgetWindow {
  const kind = string(o, "window", "month");
  if (kind === "month") return { kind: "calendar_month", timezone: "UTC" };
  const startsAt = string(o, "from");
  if (kind === "cycle")
    return {
      kind: "provider_cycle",
      cycleId: string(o, "epoch"),
      startsAt,
      endsAt: string(o, "to"),
    };
  if (kind === "reset") return { kind: "since_reset", epoch: string(o, "epoch"), startsAt };
  throw new UsageError();
}
function scope(c: Context): BudgetScope {
  const o = c.options,
    namespace = "local";
  switch (string(o, "scope", "principal")) {
    case "principal":
      return { kind: "principal", namespace, principal: "local" };
    case "connection":
      return { kind: "connection", namespace, connection: string(o, "connection") };
    case "group":
      return { kind: "group", namespace, group: string(o, "group") };
    case "platform_pool":
      return { kind: "platform_pool", namespace, poolId: string(o, "pool") };
    case "access_credential":
      return {
        kind: "access_credential",
        namespace,
        accessCredential: { kind: string(o, "credential-kind"), id: string(o, "credential-id") },
      };
    default:
      throw new UsageError();
  }
}
export async function budget(c: Context, command?: string) {
  if (command === "list") return c.rest<Budget[]>("/budgets");
  if (command !== "set") throw new UsageError();
  const o = c.options,
    id = string(o, "id"),
    previous = (await c.rest<Budget[]>("/budgets")).find((b) => b.id === id);
  const limit = o.unlimited ? null : quantity(string(o, "limit"));
  const surface = string(o, "surface", "any");
  if (!["app", "programmatic", "any"].includes(surface)) throw new UsageError();
  return c.rest("/budgets", "PUT", {
    id,
    version: (previous?.version ?? 0) + 1,
    scope: scope(c),
    surface,
    unit: limit?.unit ?? string(o, "unit"),
    limit,
    window: window(o),
    onExceed: o.warn ? "warn" : "block",
  });
}
