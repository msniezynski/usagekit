"use client";

import type { CSSProperties } from "react";
import { useCoverageView } from "@usagekit/react";
import type { CoverageInput, CoverageState, CoverageView } from "@usagekit/views";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usageMotion } from "@/components/usagekit/usage-motion";

export const coverageSummaryLabels = {
  title: "Coverage",
  description: "Requests by tracking state in this period.",
  metered: "Metered",
  passthrough: "Passthrough",
  unpriced: "Unpriced",
  cached: "Cached",
  rate_limited: "Rate limited",
  total: "Total",
  unavailable: "Unavailable",
  excludes: "Cost excludes untracked requests.",
  complete: "Every request in this period was metered.",
  unknown: "Requests outside metering are not counted here; cost may exclude untracked requests.",
  loading: "Loading coverage.",
  empty: "No requests in this period.",
  forbidden: "You cannot view coverage for this scope.",
  failed: "Coverage is unavailable right now.",
};
export type CoverageSummaryLabels = typeof coverageSummaryLabels;

export type CoverageSummaryProps = {
  view: CoverageView | null;
  labels?: Partial<CoverageSummaryLabels>;
};

const swatch: Record<CoverageState, string> = {
  metered: "bg-primary",
  cached: "bg-chart-2",
  passthrough: "bg-chart-3",
  unpriced: "bg-chart-4",
  rate_limited: "bg-destructive",
};

/** Request counts by tracking state, their shares and what cost leaves out. */
export function CoverageSummary({ view, labels: custom }: CoverageSummaryProps) {
  const labels = { ...coverageSummaryLabels, ...custom };
  const message = !view
    ? labels.loading
    : view.state === "forbidden"
      ? labels.forbidden
      : view.state === "unavailable"
        ? labels.failed
        : view.state === "empty"
          ? labels.empty
          : null;
  // Any nonzero count keeps a sliver in the bar, even when its truncated share reads "0".
  const shares =
    view?.entries.filter(
      (entry) => entry.share !== null && entry.count !== "0" && entry.count !== "unavailable",
    ) ?? [];
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle className="leading-snug">{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="gap-4 flex min-w-0 flex-col">
        {message || !view ? (
          <p role="status" className={`text-sm text-muted-foreground ${usageMotion.enter}`}>
            {message}
          </p>
        ) : (
          <>
            {shares.length > 0 && (
              <span
                aria-hidden
                className="rounded-full bg-muted h-2 flex min-w-0 gap-0.5 overflow-hidden"
              >
                {shares.map((entry, index) => (
                  <span
                    key={entry.state}
                    className={`block h-full w-[var(--share)] min-w-1 shrink rounded-[2px] transition-[width] delay-[var(--delay)] duration-700 ease-out starting:w-0 motion-reduce:transition-none ${swatch[entry.state as CoverageState]}`}
                    style={
                      {
                        "--share": `${entry.share}%`,
                        "--delay": `${index * 60}ms`,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
            )}
            <dl className="text-sm min-w-0">
              {view.entries.map((entry) => (
                <div
                  key={entry.state}
                  className={`grid grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-x-4 border-b border-border py-2 ${entry.count === "0" ? "text-muted-foreground" : ""}`}
                  data-state={entry.state}
                >
                  <dt className="flex min-w-0 items-center gap-2 break-words">
                    <span
                      aria-hidden
                      className={`rounded-[2px] size-2 shrink-0 ${entry.count === "0" ? "bg-muted-foreground/30" : swatch[entry.state as CoverageState]}`}
                    />
                    {labels[entry.state as CoverageState]}
                  </dt>
                  <dd className="min-w-0 text-right font-medium tabular-nums break-all">
                    {entry.count === "unavailable" ? labels.unavailable : entry.count}
                  </dd>
                  <dd className="text-xs/relaxed min-w-0 text-right text-muted-foreground tabular-nums break-all">
                    {entry.share === null
                      ? ""
                      : entry.share === "0" && entry.count !== "0"
                        ? "<0.01%"
                        : `${entry.share}%`}
                  </dd>
                </div>
              ))}
              {view.total !== null && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_4.5rem] gap-x-4 pt-2.5">
                  <dt className="font-medium">{labels.total}</dt>
                  <dd className="min-w-0 text-right font-semibold tabular-nums break-all">
                    {view.total}
                  </dd>
                  <dd />
                </div>
              )}
            </dl>
            <p
              className={`rounded-lg px-3.5 py-3 text-sm ${view.costExcludesUntracked === false ? "bg-muted/60 text-muted-foreground" : "border border-chart-4/50 bg-chart-4/10"}`}
            >
              {view.costExcludesUntracked === null
                ? labels.unknown
                : view.costExcludesUntracked
                  ? labels.excludes
                  : labels.complete}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Reads coverage with useCoverageView inside a MeterProvider. */
export function CoverageSummaryPanel({
  labels,
  ...input
}: CoverageInput & Pick<CoverageSummaryProps, "labels">) {
  const result = useCoverageView(input);
  if (result.state === "unavailable" || result.state === "forbidden")
    return (
      <p
        role="alert"
        className={`rounded-lg border border-dashed px-4 py-3.5 text-sm border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {result.state === "forbidden"
          ? (labels?.forbidden ?? coverageSummaryLabels.forbidden)
          : (labels?.failed ?? coverageSummaryLabels.failed)}
      </p>
    );
  return <CoverageSummary view={result.data} labels={labels} />;
}
