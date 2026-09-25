"use client";

import type { BudgetAlertCrossed } from "@usagekit/core";
import { useHeaderStatus } from "@usagekit/react";
import type { BudgetsInput, HeaderBound, HeaderStatus, Limit } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const headerStatusLabels = {
  of: "of",
  left: "left",
  resets: "Resets",
  noReset: "No reset",
  warningAt: "Warning at",
  hidden: "hidden bounds",
  unlimited: "unlimited",
  unavailable: "unavailable",
  unknown: "unknown",
  loading: "Loading status",
  failed: "Status unavailable",
  forbidden: "Status hidden",
};
export type HeaderStatusLabels = typeof headerStatusLabels;

const levelClass = {
  ok: "border-border bg-secondary text-secondary-foreground",
  warning: "border-chart-4 bg-chart-4/15 text-foreground",
  exceeded: "border-destructive bg-destructive/10 text-destructive",
} as const;

function amount(value: Limit, labels: HeaderStatusLabels): string {
  if (value === "unavailable") return labels.unavailable;
  if (value === "unlimited") return labels.unlimited;
  if (value.certainty === "unknown") return labels.unknown;
  return value.text;
}
function Pill({
  bound,
  labels,
  formatTime,
}: {
  bound: HeaderBound;
  labels: HeaderStatusLabels;
  formatTime: (iso: string) => string;
}) {
  const warning = bound.warningAt
    ? "percent" in bound.warningAt
      ? `${bound.warningAt.percent}%`
      : `${bound.warningAt.text} ${bound.warningAt.unit}`
    : null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" data-level={bound.level} className={levelClass[bound.level]} />
        }
      >
        {`${amount(bound.remaining, labels)} ${labels.of} ${amount(bound.of, labels)} ${bound.unit} ${labels.left}`}
      </TooltipTrigger>
      <TooltipContent>
        <span className="block">{`${bound.kind} ${bound.target}`}</span>
        <span className="block">
          {bound.resetsAt ? `${labels.resets} ${formatTime(bound.resetsAt)}` : labels.noReset}
        </span>
        {warning && <span className="block">{`${labels.warningAt} ${warning}`}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

export type HeaderStatusBarProps = {
  status: HeaderStatus | null;
  labels?: Partial<HeaderStatusLabels>;
  formatTime?: (iso: string) => string;
};

/** Compact inline status: one pill per visible bound, colored by level through tokens. */
export function HeaderStatusBar({
  status,
  labels: custom,
  formatTime = (t) => t,
}: HeaderStatusBarProps) {
  const labels = { ...headerStatusLabels, ...custom };
  if (!status) return <span className="text-xs text-muted-foreground">{labels.loading}</span>;
  if (status.state === "unavailable" || status.state === "forbidden")
    return (
      <span role="status" className="text-xs text-muted-foreground">
        {status.state === "forbidden" ? labels.forbidden : labels.failed}
      </span>
    );
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2" data-level={status.level}>
        {status.bounds.map((bound) => (
          <Pill key={bound.budgetId} bound={bound} labels={labels} formatTime={formatTime} />
        ))}
        {status.hidden > 0 && (
          <Badge variant="outline" className="text-muted-foreground">
            {`${status.hidden} ${labels.hidden}`}
          </Badge>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Reads the status with useHeaderStatus; pass the last command's crossings to refresh it. */
export function HeaderStatusPanel({
  labels,
  formatTime,
  crossings,
  ...input
}: Omit<BudgetsInput, "crossings"> & {
  crossings?: readonly BudgetAlertCrossed[];
} & Pick<HeaderStatusBarProps, "labels" | "formatTime">) {
  const result = useHeaderStatus(crossings ? { ...input, crossings } : input);
  return <HeaderStatusBar status={result.data} labels={labels} formatTime={formatTime} />;
}
