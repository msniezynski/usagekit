"use client";

import { useUsageSummary } from "@usagekit/react";
import type { UsageSummaryInput, UsageSummaryView } from "@usagekit/views";
import { Card } from "@/components/ui/card";
import { MeasurementCard } from "@/components/usagekit/measurement-card";
import type { MeasurementCardLabels } from "@/components/usagekit/measurement-card";
import { usageMotion } from "@/components/usagekit/usage-motion";

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

// Cells draw their own right and bottom rules; the inset grid hides the outer ones.
const cell = "cn-usage-tile min-w-0 border-r border-b border-border";

/** Complete totals per unit on one surface, each with its certainty. */
export function UsageSummaryCards({
  view,
  labels: custom,
  measurementLabels,
  unitLabels = {},
}: UsageSummaryCardsProps) {
  const labels = { ...usageSummaryCardsLabels, ...custom };
  if (!view)
    return (
      <div role="status" className="cn-usage-frame grid gap-px overflow-hidden border-border">
        <span className="sr-only">{labels.loading}</span>
        <span
          aria-hidden
          className="block h-32 animate-pulse bg-foreground/[0.04] motion-reduce:animate-none"
        />
      </div>
    );
  const message =
    view.state === "forbidden"
      ? labels.forbidden
      : view.state === "unavailable"
        ? labels.failed
        : view.state === "empty"
          ? labels.empty
          : !view.complete
            ? labels.incomplete
            : null;
  if (message)
    return (
      <p
        role="status"
        className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {message}
      </p>
    );
  return (
    <section aria-label={labels.title} className="min-w-0 space-y-3">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="-mr-px -mb-px grid min-w-0 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(view.measurements).map(([unit, value]) => (
            <div key={unit} className={cell}>
              <MeasurementCard
                variant="plain"
                title={
                  unitLabels[unit] ?? (unit === "customer_cents" ? labels.customerCharges : unit)
                }
                value={value}
                labels={measurementLabels}
              />
            </div>
          ))}
        </div>
      </Card>
      {view.unknownOperations !== null && view.unknownOperations !== "0" && (
        <p className="cn-usage-body text-muted-foreground tabular-nums">
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
      <p
        role="alert"
        className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
      >
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
