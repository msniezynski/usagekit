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
import { UsageNotice, UsageSpinner, usageMotion } from "@/components/usagekit/usage-motion";

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
    <section aria-label={labels.title} className="min-w-0 space-y-4">
      <Card className="min-w-0">
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-48 flex-1 space-y-1.5">
              <CardTitle className="leading-snug">{labels.title}</CardTitle>
              <CardDescription>{labels.description}</CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={result.refreshing}
              onClick={() => {
                setSelection(null);
                setSaved(null);
                result.refresh();
              }}
            >
              {result.refreshing ? (
                <UsageSpinner />
              ) : (
                <svg
                  aria-hidden
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 8a5 5 0 1 1-1.5-3.55M13 3v2.5h-2.5" />
                </svg>
              )}
              {labels.reload}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="cn-usage-gap-md flex flex-col">
          {message && (
            <p
              role={readable || result.state === "loading" ? "status" : "alert"}
              className={`cn-usage-body text-muted-foreground ${usageMotion.enter}`}
            >
              {message}
            </p>
          )}
          {readable && budgets.length > 0 && (
            <ul className="cn-usage-frame m-0 list-none divide-y divide-border overflow-hidden border-border p-0">
              {budgets.map((budget) => {
                const selected = activeId === budget.id;
                const name = budgetTitles[budget.id] ?? budget.id;
                return (
                  <li
                    key={budget.id}
                    data-selected={selected}
                    className={`cn-usage-cell relative flex min-w-0 flex-wrap items-center justify-between gap-3 ${selected ? "bg-muted/60" : ""} ${usageMotion.respond}`}
                  >
                    <span
                      aria-hidden
                      className={`cn-usage-notch absolute inset-y-2 left-0 w-0.5 bg-primary transition-[opacity,scale] duration-300 ease-out motion-reduce:transition-none ${selected ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0"}`}
                    />
                    <div className="min-w-0">
                      <p className="break-words font-medium">{name}</p>
                      <p className="cn-usage-body text-muted-foreground tabular-nums">
                        {budget.limit
                          ? `${formatQuantity(budget.limit)} ${budget.unit}`
                          : labels.unlimited}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant={selected ? "secondary" : "outline"}
                      size="sm"
                      aria-label={`${canWrite ? labels.edit : labels.view} ${name}`}
                      aria-pressed={selected}
                      onClick={() => choose(budget, name)}
                    >
                      {canWrite ? labels.edit : labels.view}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {readable && canWrite && creates.length > 0 && (
            <div className="space-y-2">
              <p className="cn-usage-title font-medium">{labels.createTitle}</p>
              <div className="flex flex-wrap gap-2">
                {creates.map((row) => (
                  <Button
                    key={row.budget.id}
                    type="button"
                    variant={activeId === row.budget.id ? "secondary" : "outline"}
                    aria-label={`${labels.create} ${row.title}`}
                    onClick={() => choose(row.budget, row.title, row.description)}
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
                    </svg>
                    {row.title}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {saved && (
            <UsageNotice key={saved} tone="positive">
              {labels.saved}
            </UsageNotice>
          )}
        </CardContent>
      </Card>
      {readable && active && (
        <div key={serialize([editingKey, active.budget.id])} className={usageMotion.enter}>
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
        </div>
      )}
    </section>
  );
}
