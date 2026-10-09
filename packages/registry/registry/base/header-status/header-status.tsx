"use client";

import type { BudgetAlertCrossed } from "@usagekit/core";
import { useHeaderStatus } from "@usagekit/react";
import type { BudgetsInput, HeaderBound, HeaderStatus, Limit } from "@usagekit/views";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { usageMotion } from "@/components/usagekit/usage-motion";

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
  empty: "No budgets apply.",
  loading: "Loading status",
  failed: "Status unavailable",
  forbidden: "Status hidden",
};
export type HeaderStatusLabels = typeof headerStatusLabels;

const pill =
  "cn-usage-pill cn-usage-pill-fill cn-usage-pill-md inline-flex max-w-full items-center tabular-nums text-foreground";
const levelClass = {
  ok: "border-border",
  warning: "border-chart-4/70",
  exceeded: "border-destructive/50 text-destructive",
} as const;
const dotClass = { ok: "bg-chart-2", warning: "bg-chart-4", exceeded: "bg-destructive" } as const;

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
  const text = `${amount(bound.remaining, labels)} ${labels.of} ${amount(bound.of, labels)} ${bound.unit} ${labels.left}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            data-level={bound.level}
            className={`${pill} ${levelClass[bound.level]} cn-usage-pill-link cn-usage-focus ${usageMotion.respond}`}
          />
        }
      >
        <span
          aria-hidden
          className={`cn-usage-dot shrink-0 transition-colors duration-300 motion-reduce:transition-none ${dotClass[bound.level]}`}
        />
        <span key={text} className={`min-w-0 break-words ${usageMotion.enter}`}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{`${bound.kind} ${bound.target}`}</span>
          <span>
            {bound.resetsAt ? `${labels.resets} ${formatTime(bound.resetsAt)}` : labels.noReset}
          </span>
          {warning && <span>{`${labels.warningAt} ${warning}`}</span>}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export type HeaderStatusBarProps = {
  status: HeaderStatus | null;
  labels?: Partial<HeaderStatusLabels>;
  formatTime?: (iso: string) => string;
};

/** Compact inline status: one pill per visible bound, with its level in words and color. */
export function HeaderStatusBar({
  status,
  labels: custom,
  formatTime = (t) => t,
}: HeaderStatusBarProps) {
  const labels = { ...headerStatusLabels, ...custom };
  if (!status)
    return (
      <span role="status" className="inline-flex w-40 max-w-full">
        <span className="sr-only">{labels.loading}</span>
        <span
          aria-hidden
          className="cn-usage-pill-skeleton cn-usage-pill-md block w-full animate-pulse motion-reduce:animate-none"
        />
      </span>
    );
  if (status.state === "unavailable" || status.state === "forbidden" || status.state === "empty")
    return (
      <span
        role="status"
        className={`${pill} border-dashed border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {status.state === "forbidden"
          ? labels.forbidden
          : status.state === "empty"
            ? labels.empty
            : labels.failed}
      </span>
    );
  return (
    <TooltipProvider>
      <div
        className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
        data-level={status.level}
      >
        {status.bounds.map((bound) => (
          <Pill key={bound.budgetId} bound={bound} labels={labels} formatTime={formatTime} />
        ))}
        {status.hidden > 0 && (
          <span className={`${pill} border-dashed border-border text-muted-foreground`}>
            {`${status.hidden} ${labels.hidden}`}
          </span>
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
  if (result.state === "unavailable" || result.state === "forbidden")
    return (
      <p
        role="alert"
        className={`${pill} border-dashed border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {result.state === "forbidden"
          ? (labels?.forbidden ?? headerStatusLabels.forbidden)
          : (labels?.failed ?? headerStatusLabels.failed)}
      </p>
    );
  return <HeaderStatusBar status={result.data} labels={labels} formatTime={formatTime} />;
}
