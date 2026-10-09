"use client";

import { useUsageSummary } from "@usagekit/react";
import type { UsageSummaryInput, UsageSummaryView } from "@usagekit/views";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MeasurementCertainty, MeasurementValue } from "@/components/usagekit/measurement-card";
import type { MeasurementCardLabels } from "@/components/usagekit/measurement-card";
import { usageMotion } from "@/components/usagekit/usage-motion";

export const costSummaryCardLabels = {
  title: "Provider cost",
  description: "Provider charges for tracked usage in this period.",
  loading: "Loading cost summary.",
  empty: "No tracked costs in this period.",
  forbidden: "You cannot view costs for this scope.",
  failed: "Cost summary is unavailable right now.",
  incomplete: "The whole period could not be summarized. Cost is unavailable.",
  byok: "Own key",
  platform: "Platform funded",
  costOwner: "Cost owner",
  funding: "By funding source",
};
export type CostSummaryCardLabels = typeof costSummaryCardLabels;
export type CostSummaryCardProps = {
  view: UsageSummaryView | null;
  labels?: Partial<CostSummaryCardLabels>;
  measurementLabels?: Partial<MeasurementCardLabels>;
};

/** Provider cost with its certainty and, when funding differs, a breakdown by source. */
export function CostSummaryCard({ view, labels: custom, measurementLabels }: CostSummaryCardProps) {
  const labels = { ...costSummaryCardLabels, ...custom };
  const message = !view
    ? labels.loading
    : view.state === "forbidden"
      ? labels.forbidden
      : view.state === "unavailable"
        ? labels.failed
        : view.state === "empty"
          ? labels.empty
          : null;
  if (message || !view)
    return (
      <p
        role="status"
        className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {message}
      </p>
    );
  const cost = view.complete ? view.cost : "unavailable";
  return (
    <section aria-label={labels.title} className="min-w-0">
      <Card className="w-full min-w-0">
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <CardTitle className="min-w-0 break-words leading-snug">{labels.title}</CardTitle>
            <MeasurementCertainty value={cost} labels={measurementLabels} />
          </div>
          <CardDescription>
            {view.complete ? labels.description : labels.incomplete}
          </CardDescription>
        </CardHeader>
        <CardContent className="cn-usage-gap-md flex flex-col">
          <MeasurementValue value={cost} labels={measurementLabels} />
          {view.complete && view.funding.length > 1 && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="cn-usage-label text-muted-foreground">{labels.funding}</p>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {view.funding.map((row) => (
                  <li
                    key={row.key}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="cn-usage-title block font-medium">
                        {row.fundingSource === "byok" ? labels.byok : labels.platform}
                      </span>
                      <span className="cn-usage-meta block break-words text-muted-foreground">
                        {labels.costOwner}: {row.costOwner}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <MeasurementValue value={row.cost} labels={measurementLabels} size="md" />
                      <MeasurementCertainty value={row.cost} labels={measurementLabels} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
export function CostSummaryCardPanel({
  labels,
  measurementLabels,
  ...input
}: UsageSummaryInput & Pick<CostSummaryCardProps, "labels" | "measurementLabels">) {
  const result = useUsageSummary(input);
  if (result.state === "unavailable" || result.state === "forbidden")
    return (
      <p
        role="alert"
        className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {result.state === "forbidden"
          ? (labels?.forbidden ?? costSummaryCardLabels.forbidden)
          : (labels?.failed ?? costSummaryCardLabels.failed)}
      </p>
    );
  return (
    <CostSummaryCard view={result.data} labels={labels} measurementLabels={measurementLabels} />
  );
}
