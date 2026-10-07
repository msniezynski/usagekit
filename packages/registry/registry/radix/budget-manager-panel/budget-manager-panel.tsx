"use client";

import { useState } from "react";
import { formatQuantity } from "@usagekit/core";
import type { Budget, BudgetScope, Meter } from "@usagekit/core";
import { serialize, useDefinedBudgets, useMeterBinding } from "@usagekit/react";
import type { BudgetWriter } from "@usagekit/react";
import type { BudgetTemplate } from "@usagekit/views";
import { BudgetEditor } from "@/components/usagekit/budget-editor";
import type { BudgetEditorLabels } from "@/components/usagekit/budget-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const budgetManagerPanelLabels = {
  title: "Budget management",
  description: "View limits and manage the budgets available to you.",
  loading: "Loading budget definitions.",
  empty: "No budgets have been defined.",
  forbidden: "You cannot view these budget definitions.",
  failed: "Budget definitions are unavailable right now.",
  edit: "Edit",
  view: "View",
  create: "Create",
  unlimited: "No limit",
  reload: "Reload latest budgets",
  createTitle: "New budget",
  saved: "Budget saved.",
};
export type BudgetManagerPanelLabels = typeof budgetManagerPanelLabels;
export type BudgetCreationTemplate = {
  title: string;
  description?: string;
  budget: BudgetTemplate;
};
export type BudgetManagerPanelProps = {
  scope: BudgetScope;
  /** Authorized create choices. version0 denotes a new id; id, unit and window are host-owned. */
  templates?: readonly BudgetCreationTemplate[];
  budgetWriter?: BudgetWriter;
  labels?: Partial<BudgetManagerPanelLabels>;
  editorLabels?: Partial<BudgetEditorLabels>;
  budgetTitles?: Partial<Record<string, string>>;
};

export function BudgetManagerPanel({
  scope,
  templates = [],
  budgetWriter,
  labels: custom,
  editorLabels,
  budgetTitles = {},
}: BudgetManagerPanelProps) {
  const labels = { ...budgetManagerPanelLabels, ...custom };
  const result = useDefinedBudgets({ scope });
  const binding = useMeterBinding();
  const canWrite =
    Boolean(budgetWriter ?? binding?.budgetWriter) && binding?.access.canManageBudgets === true;
  const scopeKey = serialize(scope);
  const editingKey = serialize([scope, binding?.access]);
  const [selection, setSelection] = useState<{
    key: string;
    meter: Meter | undefined;
    budget: Budget | BudgetTemplate;
    title?: string;
    description?: string;
  } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const active =
    selection?.key === editingKey && selection.meter === binding?.meter ? selection : null;
  const activeId = active?.budget.id ?? null;
  const budgets = result.data?.budgets ?? [];
  const creates = templates.filter(
    (row) =>
      row.budget.version === 0 &&
      serialize(row.budget.scope) === scopeKey &&
      !budgets.some((budget) => budget.id === row.budget.id),
  );
  // Definitions may refresh after a conflict; only an explicit selection/reload rebases a draft.
  const choose = (budget: Budget | BudgetTemplate, title?: string, description?: string) => {
    if (activeId === budget.id) return;
    setSelection({
      key: editingKey,
      meter: binding?.meter,
      budget: structuredClone(budget),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    });
    setSaved(null);
  };
  const message =
    result.state === "loading"
      ? labels.loading
      : result.state === "forbidden"
        ? labels.forbidden
        : result.state === "unavailable"
          ? labels.failed
          : result.state === "empty"
            ? labels.empty
            : null;
  const readable = result.state === "ok" || result.state === "empty";
  return (
    <section aria-label={labels.title} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{labels.title}</CardTitle>
          <CardDescription>{labels.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <p
              role={readable || result.state === "loading" ? "status" : "alert"}
              className="text-sm text-muted-foreground"
            >
              {message}
            </p>
          )}
          {readable && (
            <>
              <ul className="divide-y divide-border">
                {budgets.map((budget) => (
                  <li
                    key={budget.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words">
                        {budgetTitles[budget.id] ?? budget.id}
                      </p>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {budget.limit
                          ? `${formatQuantity(budget.limit)} ${budget.unit}`
                          : labels.unlimited}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${canWrite ? labels.edit : labels.view} ${budgetTitles[budget.id] ?? budget.id}`}
                      aria-pressed={activeId === budget.id}
                      onClick={() => choose(budget, budgetTitles[budget.id] ?? budget.id)}
                    >
                      {canWrite ? labels.edit : labels.view}
                    </Button>
                  </li>
                ))}
              </ul>
              {canWrite && creates.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{labels.createTitle}</p>
                  <div className="flex flex-wrap gap-2">
                    {creates.map((row) => (
                      <Button
                        key={row.budget.id}
                        type="button"
                        variant="outline"
                        aria-label={`${labels.create} ${row.title}`}
                        onClick={() => choose(row.budget, row.title, row.description)}
                      >
                        {labels.create} {row.title}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelection(null);
              setSaved(null);
              result.refresh();
            }}
          >
            {labels.reload}
          </Button>
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              {labels.saved}
            </p>
          )}
        </CardContent>
      </Card>
      {readable && active && (
        <BudgetEditor
          key={serialize([editingKey, active.budget])}
          budget={active.budget}
          title={active.title}
          description={active.description}
          labels={editorLabels}
          budgetWriter={budgetWriter}
          onSaved={(budget) => {
            setSaved(budget.id);
            setSelection((previous) =>
              previous?.key === editingKey && previous.meter === binding?.meter
                ? { ...previous, budget: structuredClone(budget) }
                : previous,
            );
            result.refresh();
          }}
        />
      )}
    </section>
  );
}
