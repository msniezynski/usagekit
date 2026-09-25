import type { Budget, UsageQuery } from "@usagekit/core";
import { type Context, access, string, UsageError } from "../context.js";
export async function usage(c: Context) {
  const o = c.options,
    now = new Date(),
    kind = string(o, "window", "month");
  let from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  if (kind !== "month") {
    if (!["cycle", "reset"].includes(kind)) throw new UsageError();
    const budgets = await c.rest<Budget[]>("/budgets"),
      windows = budgets
        .filter(
          (b) =>
            (!o.id || b.id === o.id) &&
            b.window.kind === (kind === "cycle" ? "provider_cycle" : "since_reset"),
        )
        .map((b) => b.window);
    if (!windows.length || new Set(windows.map((w) => JSON.stringify(w))).size > 1)
      throw new UsageError();
    const w = windows[0]!;
    if (w.kind === "provider_cycle") {
      from = w.startsAt;
      to = w.endsAt;
    }
    if (w.kind === "since_reset") {
      from = w.startsAt;
      to = now.toISOString();
    }
  }
  // `--group-by` is the documented spelling; `--group` stays accepted for existing scripts.
  if (o["group-by"] !== undefined && o.group !== undefined) throw new UsageError();
  const groupBy = string(o, "group-by", string(o, "group", "provider")).split(
    ",",
  ) as UsageQuery["groupBy"];
  if (
    groupBy.some(
      (g) =>
        ![
          "provider",
          "operation",
          "surface",
          "source",
          "connection",
          "day",
          "access_credential",
          "platform_pool",
          "funding_source",
          "tag",
        ].includes(g),
    )
  )
    throw new UsageError();
  return c.meter.usage(access, {
    scope: { kind: "principal", namespace: "local", principal: "local" },
    from,
    to,
    groupBy,
    units: string(o, "unit", "requests").split(","),
    ...(o.cursor ? { cursor: string(o, "cursor") } : {}),
    ...(o.connection ? { connection: string(o, "connection") } : {}),
  });
}
