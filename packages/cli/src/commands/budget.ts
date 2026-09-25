import type { Budget, BudgetAlert, BudgetScope, BudgetWindow } from "@usagekit/core";
import { sourcesOf } from "@usagekit/core";
import { type Context, string, strings, quantity, UsageError } from "../context.js";
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
    case "tag": {
      const tags = strings(o, "tag");
      if (tags?.length !== 1) throw new UsageError();
      return { kind: "tag", namespace, tag: tags[0]! };
    }
    default:
      throw new UsageError();
  }
}
/** `--alert 50` is a percent of the limit; `--alert 12:requests` is a quantity threshold. */
function alert(text: string): BudgetAlert {
  if (/^\d{1,3}$/.test(text)) {
    const percent = Number(text);
    if (percent < 1 || percent > 100) throw new UsageError();
    return { at: { percent } };
  }
  return { at: quantity(text) };
}
/** `--source` bounds one source exactly; `--surface` bounds a source group or `any`. */
function surface(o: Context["options"]): Budget["surface"] {
  const source = o.source;
  if (typeof source === "string") {
    if (o.surface !== undefined) throw new UsageError();
    if (![...sourcesOf("app"), ...sourcesOf("programmatic")].includes(source as never))
      throw new UsageError();
    return source as Budget["surface"];
  }
  const value = string(o, "surface", "any");
  if (!["app", "programmatic", "any"].includes(value)) throw new UsageError();
  return value as Budget["surface"];
}
export async function budget(c: Context, command?: string) {
  if (command === "list") return c.rest<Budget[]>("/budgets");
  if (command !== "set") throw new UsageError();
  const o = c.options,
    id = string(o, "id"),
    previous = (await c.rest<Budget[]>("/budgets")).find((b) => b.id === id);
  const limit = o.unlimited ? null : quantity(string(o, "limit"));
  const hardLimit = o["hard-limit"] === undefined ? undefined : quantity(string(o, "hard-limit")),
    alerts = strings(o, "alert")?.map(alert),
    allow = Boolean(o.allow || o.warn);
  if (hardLimit && !allow) throw new UsageError();
  return c.rest("/budgets", "PUT", {
    id,
    version: (previous?.version ?? 0) + 1,
    scope: scope(c),
    surface: surface(o),
    unit: limit?.unit ?? string(o, "unit"),
    limit,
    window: window(o),
    onExceed: allow ? "allow" : "block",
    ...(hardLimit ? { hardLimit } : {}),
    ...(alerts ? { alerts } : {}),
  });
}
