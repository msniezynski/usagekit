"use client";

import type { ReactNode } from "react";
import { useBudgetsView } from "@usagekit/react";
import type { AlertAt, BudgetRow, BudgetsInput, Figure, Limit } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const budgetCardLabels = {
  used: "Used",
  reserved: "Reserved",
  remaining: "Remaining",
  limit: "Limit",
  hardLimit: "Hard limit",
  alert: "Alert",
  resets: "Resets",
  noReset: "No reset",
  unlimited: "Unlimited",
  unavailable: "Unavailable",
  unknown: "Unknown",
  redacted: "This shared budget applies, but its figures are hidden from you.",
  block: "Blocks at the limit",
  allow: "Allows overage",
  ok: "Within budget",
  warning: "Warning",
  exceeded: "Exceeded",
  loading: "Loading budgets.",
  empty: "No budgets apply.",
  forbidden: "You cannot view these budgets.",
  failed: "Budgets are unavailable right now.",
};
export type BudgetCardLabels = typeof budgetCardLabels;

const levelClass = {
  ok: "border-border bg-secondary text-secondary-foreground",
  warning: "border-chart-4 bg-chart-4/15 text-foreground",
  exceeded: "border-destructive bg-destructive/10 text-destructive",
  unavailable: "border-border bg-muted text-muted-foreground",
} as const;

function figure(value: Figure | Limit, labels: BudgetCardLabels): string {
  if (value === "unavailable") return labels.unavailable;
  if (value === "unlimited") return labels.unlimited;
  if (value.certainty === "unknown") return labels.unknown;
  return `${value.text} ${value.unit}`;
}
function threshold(at: AlertAt): string {
  return "percent" in at ? `${at.percent}%` : `${at.text} ${at.unit}`;
}
function Marker({ left, label, className }: { left: string; label: ReactNode; className: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={typeof label === "string" ? label : undefined}
            className={`absolute top-0 h-full w-0.5 ${className}`}
            style={{ left: `${left}%` }}
          />
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export type BudgetCardProps = {
  row: BudgetRow;
  /** Heading for the budget; defaults to the scope kind and target. */
  title?: string;
  labels?: Partial<BudgetCardLabels>;
  formatTime?: (iso: string) => string;
};

/** One budget with its bar, markers and figures. Redacted rows show no figures. */
export function BudgetCard({ row, title, labels: custom, formatTime = (t) => t }: BudgetCardProps) {
  const labels = { ...budgetCardLabels, ...custom };
  const alerts = row.alerts.map((a, i) => ({ ...a, left: row.bar?.alerts[i] }));
  return (
    <TooltipProvider>
      <Card data-level={row.level}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{title ?? `${row.kind} ${row.target}`}</span>
            <Badge variant="outline" className={levelClass[row.level]}>
              {row.level === "unavailable" ? labels.unavailable : labels[row.level]}
            </Badge>
          </CardTitle>
          <CardDescription>
            {row.boundary.onExceed === "block" ? labels.block : labels.allow}
            {" · "}
            {row.resetsAt ? `${labels.resets} ${formatTime(row.resetsAt)}` : labels.noReset}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {row.redacted ? (
            <p className="text-sm text-muted-foreground">{labels.redacted}</p>
          ) : (
            <>
              {row.bar && (
                <div className="relative h-2 w-full overflow-visible rounded-full bg-muted">
                  <div className="flex h-full overflow-hidden rounded-full">
                    <div className="h-full bg-primary" style={{ width: `${row.bar.used}%` }} />
                    <div
                      className="h-full bg-primary/40"
                      style={{ width: `${row.bar.reserved}%` }}
                    />
                  </div>
                  {row.bar.hardLimit !== null && (
                    <Marker
                      left={row.bar.limit}
                      className="bg-foreground"
                      label={`${labels.limit} ${figure(row.limit, labels)}`}
                    />
                  )}
                  {row.bar.hardLimit !== null && row.boundary.onExceed === "allow" && (
                    <Marker
                      left={row.bar.hardLimit}
                      className="bg-destructive"
                      label={`${labels.hardLimit} ${figure(row.boundary.hardLimit ?? "unavailable", labels)}`}
                    />
                  )}
                  {alerts.map(
                    (a) =>
                      a.left !== undefined && (
                        <Marker
                          key={a.key}
                          left={a.left}
                          className={a.crossed ? "bg-chart-4" : "bg-muted-foreground"}
                          label={`${labels.alert} ${threshold(a.at)}`}
                        />
                      ),
                  )}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{labels.used}</dt>
                <dd className="text-right tabular-nums">{figure(row.used, labels)}</dd>
                <dt className="text-muted-foreground">{labels.reserved}</dt>
                <dd className="text-right tabular-nums">{figure(row.reserved, labels)}</dd>
                <dt className="text-muted-foreground">{labels.remaining}</dt>
                <dd className="text-right tabular-nums">{figure(row.remaining, labels)}</dd>
                <dt className="text-muted-foreground">{labels.limit}</dt>
                <dd className="text-right tabular-nums">{figure(row.limit, labels)}</dd>
              </dl>
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

/** Every applicable budget as a card, read with useBudgetsView inside a MeterProvider. */
export function BudgetCardsPanel({
  labels,
  formatTime,
  ...input
}: BudgetsInput & Pick<BudgetCardProps, "labels" | "formatTime">) {
  const result = useBudgetsView(input);
  const text = { ...budgetCardLabels, ...labels };
  if (!result.data) return <p className="text-sm text-muted-foreground">{text.loading}</p>;
  if (result.data.state !== "ok")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {result.data.state === "empty"
          ? text.empty
          : result.data.state === "forbidden"
            ? text.forbidden
            : text.failed}
      </p>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {result.data.rows.map((row) => (
        <BudgetCard key={row.id} row={row} labels={labels} formatTime={formatTime} />
      ))}
    </div>
  );
}
