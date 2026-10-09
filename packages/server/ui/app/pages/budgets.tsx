import { useMemo, useState } from "react";
import type { BudgetScope } from "@usagekit/core";
import type { BudgetsInput, BudgetTemplate, ConnectionInput } from "@usagekit/views";
import { BudgetCardsPanel } from "@/components/usagekit/budget-card";
import { BudgetManagerPanel } from "@/components/usagekit/budget-manager-panel";
import { UsageSegmented, usageMotion } from "@/components/usagekit/usage-motion";
import { localScope } from "../session";

type LocalBudgetScope = Extract<BudgetScope, { kind: "principal" | "connection" }>;
const monthlyTemplates = (scope: LocalBudgetScope, units: readonly string[]) =>
  units.map((unit) => ({
    title: `Monthly ${unit === "customer_cents" ? "customer charges" : unit}`,
    description: "Calendar month · UTC · all request surfaces",
    budget: {
      id: `ui-monthly:${scope.kind}:${encodeURIComponent(scope.kind === "principal" ? scope.principal : scope.connection)}:${encodeURIComponent(unit)}`,
      version: 0,
      scope,
      unit,
      surface: "any" as const,
      window: { kind: "calendar_month" as const, timezone: "UTC" },
    } satisfies BudgetTemplate,
  }));

/** Existing budgets keep their native scope, unit and window. Templates create new definitions only. */
export function BudgetsPage({
  budgetInput,
  connections = [],
  units = ["requests", "cents"],
}: {
  budgetInput?: BudgetsInput | null;
  connections?: readonly ConnectionInput[];
  units?: readonly string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const connectionId =
    selected && connections.some((item) => item.id === selected) ? selected : connections[0]?.id;
  const choices = [...new Set(["requests", "cents", ...units])].sort();
  const unitKey = JSON.stringify(choices);
  const principalTemplates = useMemo(() => monthlyTemplates(localScope, choices), [unitKey]);
  const connectionScope: LocalBudgetScope | null = connectionId
    ? { kind: "connection", namespace: localScope.namespace, connection: connectionId }
    : null;
  const connectionTemplates = useMemo(
    () => (connectionScope ? monthlyTemplates(connectionScope, choices) : []),
    [connectionId, unitKey],
  );
  return (
    <section aria-label="Budgets" className="min-w-0 space-y-10">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Budgets</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Edit existing limits or create a monthly limit. These controls do not reset usage or
          change a balance.
        </p>
      </div>
      {budgetInput && (
        <section aria-label="Applicable budget status" className="space-y-3">
          <h2 className="text-base font-semibold">Applicable budget status</h2>
          <BudgetCardsPanel {...budgetInput} />
        </section>
      )}
      <section aria-label="Local principal budgets" className="space-y-3">
        <h2 className="text-base font-semibold">Local principal</h2>
        <BudgetManagerPanel
          scope={localScope}
          templates={principalTemplates}
          budgetTitles={Object.fromEntries(
            principalTemplates.map((template) => [template.budget.id, template.title]),
          )}
        />
      </section>
      {connections.length ? (
        <section aria-label="Connection budgets" className="space-y-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Connection budgets</h2>
            <UsageSegmented
              label="Choose budget connection"
              value={connectionId ?? null}
              options={connections.map((item) => ({
                value: item.id,
                label: item.label ?? item.id,
              }))}
              onChange={setSelected}
            />
          </div>
          {connectionScope && (
            <BudgetManagerPanel
              key={connectionId}
              scope={connectionScope}
              templates={connectionTemplates}
              budgetTitles={Object.fromEntries(
                connectionTemplates.map((template) => [template.budget.id, template.title]),
              )}
            />
          )}
        </section>
      ) : (
        <p
          className={`rounded-lg border border-dashed border-border px-4 py-3.5 text-sm text-muted-foreground ${usageMotion.enter}`}
        >
          Add a provider connection to manage its connection budgets.
        </p>
      )}
    </section>
  );
}
