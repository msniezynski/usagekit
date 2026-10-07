"use client";

import { useUsageSummary } from "@usagekit/react";
import type { UsageSummaryInput, UsageSummaryView } from "@usagekit/views";
import { MeasurementCard } from "@/components/usagekit/measurement-card";
import type { MeasurementCardLabels } from "@/components/usagekit/measurement-card";

export const usageSummaryCardsLabels = {
  title: "Usage",
  customerCharges: "Customer charges",
  loading: "Loading usage summary.",
  empty: "No usage in this period.",
  forbidden: "You cannot view usage for this scope.",
  failed: "Usage summary is unavailable right now.",
  incomplete: "The summary could not cover the whole period. Narrow the period and try again.",
  unknownOperations: "Operations with unknown measurements",
};
export type UsageSummaryCardsLabels = typeof usageSummaryCardsLabels;
export type UsageSummaryCardsProps = {
  view: UsageSummaryView | null;
  labels?: Partial<UsageSummaryCardsLabels>;
  measurementLabels?: Partial<MeasurementCardLabels>;
  unitLabels?: Partial<Record<string, string>>;
};
export function UsageSummaryCards({
  view,
  labels: custom,
  measurementLabels,
  unitLabels = {},
}: UsageSummaryCardsProps) {
  const labels = { ...usageSummaryCardsLabels, ...custom };
  const message = !view
    ? labels.loading
    : view.state === "forbidden"
      ? labels.forbidden
      : view.state === "unavailable"
        ? labels.failed
        : view.state === "empty"
          ? labels.empty
          : !view.complete
            ? labels.incomplete
            : null;
  if (message || !view)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    );
  return (
    <section aria-label={labels.title} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(view.measurements).map(([unit, value]) => (
          <MeasurementCard
            key={unit}
            title={unitLabels[unit] ?? (unit === "customer_cents" ? labels.customerCharges : unit)}
            value={value}
            labels={measurementLabels}
          />
        ))}
      </div>
      {view.unknownOperations !== null && view.unknownOperations !== "0" && (
        <p className="text-sm text-muted-foreground">
          {labels.unknownOperations}: {view.unknownOperations}
        </p>
      )}
    </section>
  );
}
export function UsageSummaryCardsPanel({
  labels,
  measurementLabels,
  unitLabels,
  ...input
}: UsageSummaryInput &
  Pick<UsageSummaryCardsProps, "labels" | "measurementLabels" | "unitLabels">) {
  const result = useUsageSummary(input);
  if (result.state === "unavailable" || result.state === "forbidden")
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {result.state === "forbidden"
          ? (labels?.forbidden ?? usageSummaryCardsLabels.forbidden)
          : (labels?.failed ?? usageSummaryCardsLabels.failed)}
      </p>
    );
  return (
    <UsageSummaryCards
      view={result.data}
      labels={labels}
      measurementLabels={measurementLabels}
      unitLabels={unitLabels}
    />
  );
}
