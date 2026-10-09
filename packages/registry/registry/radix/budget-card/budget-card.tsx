"use client";

import { useBudgetsView } from "@usagekit/react";
import type { AlertAt, BudgetRow, BudgetsInput, Figure, Limit } from "@usagekit/views";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UsageMark, UsageTrack } from "@/components/usagekit/usage-meter";
import { UsageStatus, usageMotion } from "@/components/usagekit/usage-motion";
import type { UsageTone } from "@/components/usagekit/usage-motion";

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
  exceeded: "Over limit",
  loading: "Loading budgets.",
  empty: "No budgets apply.",
  forbidden: "You cannot view these budgets.",
  failed: "Budgets are unavailable right now.",
};
export type BudgetCardLabels = typeof budgetCardLabels;
/** The row fields a card presents; hosts with native accounting can supply just these. */
export type BudgetCardRow = Pick<
  BudgetRow,
  | "alerts"
  | "bar"
  | "level"
  | "kind"
  | "target"
  | "boundary"
  | "resetsAt"
  | "redacted"
  | "used"
  | "reserved"
  | "remaining"
  | "limit"
>;

const tone: Record<BudgetRow["level"], UsageTone> = {
  ok: "positive",
  warning: "warning",
  exceeded: "exceeded",
  unavailable: "unknown",
};

function figure(value: Figure | Limit, labels: BudgetCardLabels): string {
  if (value === "unavailable") return labels.unavailable;
  if (value === "unlimited") return labels.unlimited;
  if (value.certainty === "unknown") return labels.unknown;
  return `${value.text} ${value.unit}`;
}
/** An ISO instant reads as "2026-11-01 00:00 UTC"; hosts pass formatTime for local formats. */
function utcMinute(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?Z$/.exec(iso);
  return match ? `${match[1]} ${match[2]} UTC` : iso;
}
function threshold(at: AlertAt): string {
  return "percent" in at ? `${at.percent}%` : `${at.text} ${at.unit}`;
}

export type BudgetCardProps = {
  row: BudgetCardRow;
  /** Heading for the budget; defaults to the scope kind and target. */
  title?: string;
  labels?: Partial<BudgetCardLabels>;
  formatTime?: (iso: string) => string;
  className?: string;
};

/** One budget with used and reserved figures, its limits on the scale and the reset time. */
export function BudgetCard({
  row,
  title,
  labels: custom,
  formatTime = utcMinute,
  className = "",
}: BudgetCardProps) {
  const labels = { ...budgetCardLabels, ...custom };
  const bar = row.level === "unavailable" ? null : row.bar;
  const marks = bar
    ? [
        ...(bar.hardLimit !== null
          ? [
              {
                key: "limit",
                at: bar.limit,
                tone: "bg-foreground",
                label: `${labels.limit} ${figure(row.limit, labels)}`,
              },
            ]
          : []),
        ...(bar.hardLimit !== null && row.boundary.onExceed === "allow"
          ? [
              {
                key: "hard",
                at: bar.hardLimit,
                tone: "bg-destructive",
                label: `${labels.hardLimit} ${figure(row.boundary.hardLimit ?? "unavailable", labels)}`,
              },
            ]
          : []),
        ...row.alerts.flatMap((alert, index) => {
          const at = bar.alerts[index];
          return at === undefined
            ? []
            : [
                {
                  key: alert.key,
                  at,
                  tone: alert.crossed ? "bg-chart-4" : "bg-muted-foreground/70",
                  label: `${labels.alert} ${threshold(alert.at)}`,
                },
              ];
        }),
      ]
    : [];
  const used = figure(row.used, labels);
  const level = row.level === "unavailable" ? labels.unavailable : labels[row.level];
  return (
    <Card data-level={row.level} className={`min-w-0 ${className}`}>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <CardTitle className="min-w-0 break-words leading-snug">
            {title ?? `${row.kind} ${row.target}`}
          </CardTitle>
          <UsageStatus key={row.level} tone={tone[row.level]} className={usageMotion.enter}>
            {level}
          </UsageStatus>
        </div>
        <CardDescription className="cn-usage-meta flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{row.boundary.onExceed === "block" ? labels.block : labels.allow}</span>
          <span className="tabular-nums">
            {row.resetsAt ? (
              <>
                {labels.resets} <time dateTime={row.resetsAt}>{formatTime(row.resetsAt)}</time>
              </>
            ) : (
              labels.noReset
            )}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="cn-usage-gap-md flex min-w-0 flex-col">
        {row.redacted ? (
          <p className="cn-usage-panel cn-usage-body border border-dashed border-border text-muted-foreground">
            {labels.redacted}
          </p>
        ) : (
          <>
            <dl className="grid min-w-0 grid-cols-3 gap-x-4 gap-y-3">
              <div className="col-span-3 min-w-0">
                <dt className="cn-usage-label text-muted-foreground">{labels.used}</dt>
                <dd
                  key={used}
                  className={`cn-usage-figure-md mt-1 break-words font-semibold tabular-nums ${row.level === "exceeded" ? "text-destructive" : ""} ${usageMotion.enter}`}
                >
                  {used}
                </dd>
              </div>
              {[
                [labels.reserved, figure(row.reserved, labels)],
                [labels.remaining, figure(row.remaining, labels)],
                [labels.limit, figure(row.limit, labels)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="cn-usage-label text-muted-foreground">{label}</dt>
                  <dd className="cn-usage-value mt-1 break-words font-medium tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {bar && (
              <UsageTrack
                level={row.level === "unavailable" ? "ok" : row.level}
                fill={`${bar.used}%`}
                reserved={`${bar.reserved}%`}
                trace={row.used !== "unavailable" && row.used.text !== "" && row.used.text !== "0"}
                className="mt-1"
                marks={marks.map((mark) => (
                  <UsageMark
                    key={mark.key}
                    at={`${mark.at}%`}
                    label={mark.label}
                    tone={mark.tone}
                  />
                ))}
              />
            )}
            {marks.length > 0 && (
              <ul
                aria-hidden
                className="cn-usage-label m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-muted-foreground tabular-nums"
              >
                {marks.map((mark) => (
                  <li key={mark.key} className="inline-flex items-center gap-1.5">
                    <span className={`h-3 w-px ${mark.tone}`} />
                    {mark.label}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PanelMessage({ role, children }: { role: "alert" | "status"; children: string }) {
  return (
    <p
      role={role}
      className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
    >
      {children}
    </p>
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
  if (result.state === "unavailable" || result.state === "forbidden")
    return (
      <PanelMessage role="alert">
        {result.state === "forbidden" ? text.forbidden : text.failed}
      </PanelMessage>
    );
  if (!result.data)
    return (
      <div role="status" className="grid gap-4 sm:grid-cols-2">
        <span className="sr-only">{text.loading}</span>
        {[0, 1].map((key) => (
          <span
            key={key}
            aria-hidden
            className="cn-usage-skeleton-card block h-52 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  if (result.data.state !== "ok")
    return (
      <PanelMessage role="status">
        {result.data.state === "empty"
          ? text.empty
          : result.data.state === "forbidden"
            ? text.forbidden
            : text.failed}
      </PanelMessage>
    );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {result.data.rows.map((row) => (
        <BudgetCard key={row.id} row={row} labels={labels} formatTime={formatTime} />
      ))}
    </div>
  );
}
