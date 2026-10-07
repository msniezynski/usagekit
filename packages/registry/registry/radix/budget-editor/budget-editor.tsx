"use client";

import { useId } from "react";
import type { Budget } from "@usagekit/core";
import { useBudgetEditor } from "@usagekit/react";
import type { BudgetWriter } from "@usagekit/react";
import type { BudgetTemplate } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const budgetEditorLabels = {
  title: "Budget",
  limit: "Limit",
  unlimited: "No limit",
  limited: "Set a limit",
  behavior: "At the limit",
  block: "Block requests",
  allow: "Allow overage",
  hardLimit: "Hard limit",
  alerts: "Alerts",
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
  const save = async () => {
    const result = await editor.save();
    if (result?.outcome === "saved") onSaved?.(result.budget);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? labels.title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          aria-label={title ?? labels.title}
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {!editor.canWrite && (
            <p role="status" className="text-sm text-muted-foreground">
              {labels.readOnly}
            </p>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={`${id}-limit`}>
                {labels.limit} ({budget.unit})
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
            <Input
              id={`${id}-limit`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.limit}
              readOnly={!editable}
              disabled={draft.unlimited}
              aria-invalid={fieldInvalid("limit")}
              aria-describedby={editor.errors ? `${id}-feedback` : undefined}
              onChange={(event) => change({ limit: event.target.value })}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{labels.behavior}</legend>
            <div className="flex flex-wrap gap-2">
              {(["block", "allow"] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={draft.onExceed === mode ? "secondary" : "outline"}
                  disabled={!editable}
                  aria-pressed={draft.onExceed === mode}
                  onClick={() =>
                    change({ onExceed: mode, ...(mode === "block" ? { hardLimit: "" } : {}) })
                  }
                >
                  {labels[mode]}
                </Button>
              ))}
            </div>
          </fieldset>
          {draft.onExceed === "allow" && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-hard`}>
                {labels.hardLimit} ({budget.unit})
              </Label>
              <Input
                id={`${id}-hard`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draft.hardLimit}
                readOnly={!editable}
                aria-invalid={fieldInvalid("hardLimit")}
                onChange={(event) => change({ hardLimit: event.target.value })}
              />
            </div>
          )}
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">{labels.alerts}</legend>
            {draft.alerts.map((alert, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor={`${id}-alert-${index}`}>
                    {labels.alertValue} {index + 1} ({alert.kind === "percent" ? "%" : budget.unit})
                  </Label>
                  <Input
                    id={`${id}-alert-${index}`}
                    type="text"
                    inputMode="decimal"
                    value={alert.value}
                    readOnly={!editable}
                    aria-invalid={fieldInvalid(`alerts.${index}`)}
                    onChange={(event) =>
                      change({
                        alerts: draft.alerts.map((row, at) =>
                          at === index ? { ...row, value: event.target.value } : row,
                        ),
                      })
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                  size="sm"
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
              {labels.addAlert}
            </Button>
          </fieldset>
          {message && (
            <p
              id={`${id}-feedback`}
              role={editor.state === "saved" && !editor.errors ? "status" : "alert"}
              className="text-sm text-muted-foreground"
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
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!editable || !editor.dirty}>
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
