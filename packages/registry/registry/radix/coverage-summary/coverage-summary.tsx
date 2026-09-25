"use client";

import { useCoverageView } from "@usagekit/react";
import type { CoverageInput, CoverageState, CoverageView } from "@usagekit/views";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

/** Five counts with shares and the sentence that cost excludes untracked requests. */
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {message || !view ? (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-sm">
              {view.entries.map((entry) => (
                <div key={entry.state} className="contents" data-state={entry.state}>
                  <dt className="text-muted-foreground">{labels[entry.state as CoverageState]}</dt>
                  <dd className="text-right tabular-nums">
                    {entry.count === "unavailable" ? labels.unavailable : entry.count}
                  </dd>
                  <dd className="text-right tabular-nums text-muted-foreground">
                    {entry.share === null ? "" : `${entry.share}%`}
                  </dd>
                </div>
              ))}
              {view.total !== null && (
                <div className="contents">
                  <dt className="font-medium">{labels.total}</dt>
                  <dd className="text-right font-medium tabular-nums">{view.total}</dd>
                  <dd />
                </div>
              )}
            </dl>
            <p className="text-sm text-muted-foreground">
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
  return <CoverageSummary view={result.data} labels={labels} />;
}
