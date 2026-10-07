"use client";

import type { Figure } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const measurementCardLabels = {
  measured: "Measured",
  estimated: "Estimated",
  unknown: "Unknown",
  unavailable: "Unavailable",
  cents: "cents",
};
export type MeasurementCardLabels = typeof measurementCardLabels;
export type MeasurementCardProps = {
  title: string;
  value: Figure;
  description?: string;
  labels?: Partial<MeasurementCardLabels>;
};

/** Exact measurement text and its certainty. Unknown and unavailable never display zero. */
export function MeasurementCard({
  title,
  value,
  description,
  labels: custom,
}: MeasurementCardProps) {
  const labels = { ...measurementCardLabels, ...custom };
  const certainty = value === "unavailable" ? "unavailable" : value.certainty;
  return (
    <Card className="min-w-0 w-full" data-certainty={certainty}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="min-w-0 text-2xl font-semibold tabular-nums break-all">
          {value === "unavailable" ? (
            labels.unavailable
          ) : value.certainty === "unknown" ? (
            labels.unknown
          ) : (
            <>
              {value.text}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                {value.unit === "customer_cents" ? labels.cents : value.unit}
              </span>
            </>
          )}
        </p>
        <Badge variant={certainty === "measured" ? "secondary" : "outline"}>
          {labels[certainty]}
        </Badge>
      </CardContent>
    </Card>
  );
}
