"use client";

import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Budget } from "@usagekit/core";
import { useBudgetEditor } from "@usagekit/react";
import type { BudgetWriter } from "@usagekit/react";
import type { BudgetTemplate } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  UsageNotice,
  UsageReveal,
  UsageSegmented,
  UsageSpinner,
  usageMotion,
} from "@/components/usagekit/usage-motion";
import type { UsageNoticeTone } from "@/components/usagekit/usage-motion";

export const budgetEditorLabels = {
  title: "Budget",
  limit: "Limit",
  unlimited: "No limit",
  limited: "Set a limit",
  behavior: "At the limit",
  block: "Block requests",
  allow: "Allow overage",
  blockHelp: "Requests over the limit are refused.",
  allowHelp: "Requests continue past the limit until the hard limit.",
  hardLimit: "Hard limit",
  alerts: "Alerts",
  alertsHelp: "Get warned as usage crosses each threshold. Alerts never block requests.",
  addAlert: "Add alert",
  removeAlert: "Remove alert",
  percent: "Percent",
  quantity: "Quantity",
  alertValue: "Alert threshold",
  save: "Save budget",
  saving: "Saving budget…",
  reset: "Reset changes",
  readOnly: "View only. Budget changes are managed by your administrator.",
  saved: "Budget saved.",
  conflict: "This budget changed elsewhere. Reload the latest budget before saving your changes.",
  invalid: "Check the highlighted value. Use a nonnegative exact decimal without rounding.",
  forbidden: "You cannot change this budget.",
  unavailable: "The budget could not be saved. Try again when the service is available.",
  unknown: "The save result is unknown. Check its status before making another change.",
  reconcile: "Check save status",
  notSaved: "The previous change was not saved. You can try again.",
};
export type BudgetEditorLabels = typeof budgetEditorLabels;
export type BudgetEditorProps = {
  budget: Budget | BudgetTemplate;
  title?: string;
  description?: string;
  budgetWriter?: BudgetWriter;
  labels?: Partial<BudgetEditorLabels>;
  onSaved?: (budget: Budget) => void;
};

/** Text input with its unit beside the value; the unit is part of the label for assistive tech. */
function UnitField({ unit, children }: { unit: string; children: ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <span
        aria-hidden
        className="text-sm text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center"
      >
        {unit}
      </span>
    </span>
  );
}

/** Host fixes identity, unit and window. The writer must authorize every request on the server. */
export function BudgetEditor({
  budget,
  title,
  description,
  budgetWriter,
  labels: custom,
  onSaved,
}: BudgetEditorProps) {
  const labels = { ...budgetEditorLabels, ...custom };
  const editor = useBudgetEditor({ budget, ...(budgetWriter ? { budgetWriter } : {}) });
  const id = useId();
  const editable =
    editor.canWrite && !editor.pending && !editor.ambiguous && editor.state !== "conflict";
  const draft = editor.draft;
  const change = (patch: Partial<typeof draft>) => editor.setDraft({ ...draft, ...patch });
  const fieldInvalid = (field: string) =>
    editor.errors?.field === field || editor.errors?.field.startsWith(`${field}.`) || undefined;
  const message = editor.ambiguous
    ? labels.unknown
    : editor.errors
      ? labels.invalid
      : editor.state === "saved"
        ? labels.saved
        : editor.state === "conflict"
          ? labels.conflict
          : editor.state === "invalid"
            ? labels.invalid
            : editor.state === "forbidden"
              ? labels.forbidden
              : editor.state === "unavailable"
                ? labels.unavailable
                : null;
  const tone: UsageNoticeTone =
    editor.state === "saved" && !editor.errors && !editor.ambiguous
      ? "positive"
      : editor.ambiguous || editor.state === "conflict"
        ? "warning"
        : "error";
  const save = async () => {
    const result = await editor.save();
    if (result?.outcome === "saved") onSaved?.(result.budget);
  };
  const unitSpace = "pr-[calc(1.25rem_+_var(--unit,4ch))]";
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="leading-snug">{title ?? labels.title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          aria-label={title ?? labels.title}
          className="gap-6 flex flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!editor.canWrite && (
            <p
              role="status"
              className="rounded-lg bg-muted/50 px-3.5 py-3 text-sm flex items-center gap-2 text-muted-foreground"
            >
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="size-4 shrink-0"
              >
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </svg>
              {labels.readOnly}
            </p>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`${id}-limit`}>
                {labels.limit} <span className="sr-only">({budget.unit})</span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!editable}
                aria-pressed={draft.unlimited}
                onClick={() => change({ unlimited: !draft.unlimited, hardLimit: "" })}
              >
                {draft.unlimited ? labels.limited : labels.unlimited}
              </Button>
            </div>
            <UnitField unit={budget.unit}>
              <Input
                id={`${id}-limit`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draft.unlimited ? "" : draft.limit}
                placeholder={draft.unlimited ? labels.unlimited : undefined}
                readOnly={!editable}
                disabled={draft.unlimited}
                aria-invalid={fieldInvalid("limit")}
                aria-describedby={editor.errors ? `${id}-feedback` : undefined}
                className={`tabular-nums ${unitSpace}`}
                style={{ "--unit": `${budget.unit.length}ch` } as CSSProperties}
                onChange={(event) => change({ limit: event.target.value })}
              />
            </UnitField>
          </div>
          <fieldset className="m-0 min-w-0 space-y-2 border-0 p-0">
            <legend className="text-sm mb-2 font-medium">{labels.behavior}</legend>
            <UsageSegmented
              value={draft.onExceed}
              disabled={!editable}
              options={[
                { value: "block", label: labels.block },
                { value: "allow", label: labels.allow },
              ]}
              onChange={(mode) =>
                change({ onExceed: mode, ...(mode === "block" ? { hardLimit: "" } : {}) })
              }
            />
            <p
              key={draft.onExceed}
              className={`text-xs/relaxed text-muted-foreground ${usageMotion.enter}`}
            >
              {draft.onExceed === "block" ? labels.blockHelp : labels.allowHelp}
            </p>
            <UsageReveal open={draft.onExceed === "allow"}>
              <div className="space-y-2 pt-3 pb-0.5">
                <Label htmlFor={`${id}-hard`}>
                  {labels.hardLimit} <span className="sr-only">({budget.unit})</span>
                </Label>
                <UnitField unit={budget.unit}>
                  <Input
                    id={`${id}-hard`}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.hardLimit}
                    readOnly={!editable}
                    aria-invalid={fieldInvalid("hardLimit")}
                    className={`tabular-nums ${unitSpace}`}
                    style={{ "--unit": `${budget.unit.length}ch` } as CSSProperties}
                    onChange={(event) => change({ hardLimit: event.target.value })}
                  />
                </UnitField>
              </div>
            </UsageReveal>
          </fieldset>
          <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0">
            <legend className="text-sm mb-1 font-medium">{labels.alerts}</legend>
            <p className="text-xs/relaxed text-muted-foreground">{labels.alertsHelp}</p>
            {draft.alerts.map((alert, index) => (
              <div
                key={index}
                className={`flex min-w-0 flex-wrap items-end gap-2 ${usageMotion.enter}`}
              >
                <div className="min-w-0 flex-1 basis-40 space-y-2">
                  <Label htmlFor={`${id}-alert-${index}`} className="font-normal">
                    {labels.alertValue} {index + 1}{" "}
                    <span className="sr-only">
                      ({alert.kind === "percent" ? "%" : budget.unit})
                    </span>
                  </Label>
                  <UnitField unit={alert.kind === "percent" ? "%" : budget.unit}>
                    <Input
                      id={`${id}-alert-${index}`}
                      type="text"
                      inputMode="decimal"
                      value={alert.value}
                      readOnly={!editable}
                      aria-invalid={fieldInvalid(`alerts.${index}`)}
                      className={`tabular-nums ${unitSpace}`}
                      style={
                        {
                          "--unit": `${alert.kind === "percent" ? 1 : budget.unit.length}ch`,
                        } as CSSProperties
                      }
                      onChange={(event) =>
                        change({
                          alerts: draft.alerts.map((row, at) =>
                            at === index ? { ...row, value: event.target.value } : row,
                          ),
                        })
                      }
                    />
                  </UnitField>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!editable}
                  aria-label={`${labels.percent} / ${labels.quantity} ${index + 1}`}
                  onClick={() =>
                    change({
                      alerts: draft.alerts.map((row, at) =>
                        at === index
                          ? { ...row, kind: row.kind === "percent" ? "quantity" : "percent" }
                          : row,
                      ),
                    })
                  }
                >
                  {labels[alert.kind]}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!editable}
                  aria-label={`${labels.removeAlert} ${index + 1}`}
                  onClick={() =>
                    change({ alerts: draft.alerts.filter((_row, at) => at !== index) })
                  }
                >
                  {labels.removeAlert}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!editable || draft.alerts.length >= 8}
              onClick={() => change({ alerts: [...draft.alerts, { kind: "percent", value: "" }] })}
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
              {labels.addAlert}
            </Button>
          </fieldset>
          {message && (
            <UsageNotice
              key={`${message}:${editor.errors?.field ?? ""}`}
              id={`${id}-feedback`}
              tone={tone}
              role={editor.state === "saved" && !editor.errors ? "status" : "alert"}
            >
              {message}
              {editor.errors && (
                <>
                  {" "}
                  {editor.errors.field.split(".")[0] === "alerts"
                    ? labels.alerts
                    : editor.errors.field === "hardLimit"
                      ? labels.hardLimit
                      : labels.limit}
                  : {editor.errors.reason}
                </>
              )}
            </UsageNotice>
          )}
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <Button type="submit" disabled={!editable || !editor.dirty}>
              {editor.pending && <UsageSpinner />}
              {editor.pending ? labels.saving : labels.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!editable || !editor.dirty}
              onClick={editor.reset}
            >
              {labels.reset}
            </Button>
            {editor.ambiguous && (
              <Button
                type="button"
                variant="outline"
                disabled={editor.pending}
                className={usageMotion.enter}
                onClick={() => {
                  void editor.reconcile();
                }}
              >
                {labels.reconcile}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
