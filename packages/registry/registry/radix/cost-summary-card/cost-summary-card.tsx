"use client";

import { useUsageSummary } from "@usagekit/react";
import type { UsageSummaryInput, UsageSummaryView } from "@usagekit/views";
import { MeasurementCard } from "@/components/usagekit/measurement-card";
import type { MeasurementCardLabels } from "@/components/usagekit/measurement-card";

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
};
export type CostSummaryCardLabels = typeof costSummaryCardLabels;
export type CostSummaryCardProps = {
  view: UsageSummaryView | null;
  labels?: Partial<CostSummaryCardLabels>;
  measurementLabels?: Partial<MeasurementCardLabels>;
};
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
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    );
  return (
    <section aria-label={labels.title} className="space-y-4">
      <MeasurementCard
        title={labels.title}
        description={view.complete ? labels.description : labels.incomplete}
        value={view.complete ? view.cost : "unavailable"}
        labels={measurementLabels}
      />
      {view.complete && view.funding.length > 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {view.funding.map((row) => (
            <MeasurementCard
              key={row.key}
              title={row.fundingSource === "byok" ? labels.byok : labels.platform}
              description={`${labels.costOwner}: ${row.costOwner}`}
              value={row.cost}
              labels={measurementLabels}
            />
          ))}
        </div>
      )}
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
      <p role="alert" className="text-sm text-muted-foreground">
        {result.state === "forbidden"
          ? (labels?.forbidden ?? costSummaryCardLabels.forbidden)
          : (labels?.failed ?? costSummaryCardLabels.failed)}
      </p>
    );
  return (
    <CostSummaryCard view={result.data} labels={labels} measurementLabels={measurementLabels} />
  );
}
