import type { AccessContext } from "@usagekit/core";
import { encodeWire, parseBudget } from "@usagekit/http";
import type { SqliteStore } from "@usagekit/store-sqlite";

const canonical = (value: unknown): string => {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, part]) => part !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, part]) => `${JSON.stringify(key)}:${canonical(part)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

/** Immutable, unique budget versions prove success/conflict even after later edits. */
export function reconcileBudget(store: SqliteStore, access: AccessContext, raw: unknown): Response {
  if (!access.canManageBudgets) return Response.json({ outcome: "forbidden" }, { status: 403 });
  const budget = parseBudget(raw);
  if (!budget) return Response.json({ error: "invalid_budget" }, { status: 400 });
  if (budget.scope.namespace !== access.namespace)
    return Response.json({ outcome: "forbidden" }, { status: 403 });
  const stored = store.getBudgetVersion(budget.scope.namespace, budget.id, budget.version);
  const result = stored
    ? canonical(stored) === canonical(budget)
      ? { outcome: "saved", budget: stored }
      : { outcome: "conflict", reason: "budget_version" }
    : {
        outcome: "unavailable",
        message: "The original budget write has no confirmed result.",
        ambiguous: true,
      };
  return new Response(encodeWire(result), { headers: { "Content-Type": "application/json" } });
}
