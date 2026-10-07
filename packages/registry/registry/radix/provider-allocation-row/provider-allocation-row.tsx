"use client";
import { useId } from "react";
import { allocationLimitFromAvailable, projectBudgetExhaustion } from "@usagekit/views";
import type { BudgetProjectionInput, ProviderAllocationRow } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { figureText, fundingLabel } from "@/components/usagekit/provider-feedback";
export const providerAllocationLabels = {
  title: "Allocations",
  description:
    "Own-key units and customer credit limits are independent. A limit change never transfers a balance.",
  app: "App",
  programmatic: "Programmatic",
  limit: "Limit",
  unlimited: "No limit",
  limited: "Set a limit",
  used: "Used",
  reserved: "Reserved",
  remaining: "Remaining",
  available: "Use available balance",
  unavailable: "Fresh, measured availability in the same unit is required.",
  save: "Save allocations",
  empty: "No allocation is configured.",
  forecast: "Budget forecast",
  estimated: "Estimated exhaustion",
  exhausted: "Exhausted",
  within: "Within this period",
  noUsage: "No measured usage yet",
  unknown: "Unknown",
};
export type ProviderAllocationLabels = typeof providerAllocationLabels;
export type Draft = { limit: string; unlimited: boolean };
export function AllocationRow({
  row,
  draft,
  change,
  editable,
  fresh,
  labels,
  projection,
}: {
  row: ProviderAllocationRow;
  draft: Draft;
  change: (value: Draft) => void;
  editable: boolean;
  fresh: boolean;
  labels: ProviderAllocationLabels;
  projection?: BudgetProjectionInput;
}) {
  const id = useId();
  const available =
    fresh && row.available && row.availabilityBasis
      ? allocationLimitFromAvailable({
          used: row.used,
          reserved: row.reserved,
          available: row.available,
          availabilityBasis: row.availabilityBasis,
        })
      : { outcome: "unavailable" as const, reason: labels.unavailable };
  const suggestion =
    available.outcome === "ready" && available.limit.unit === row.unit
      ? available.limit.text
      : null;
  const forecast = projection ? projectBudgetExhaustion(projection) : null;
  return (
    <section
      aria-label={`${fundingLabel(row.fundingSource)} ${labels[row.surface]}`}
      className="space-y-3 rounded-lg border border-border p-4 min-w-0"
    >
      <h3 className="font-medium">
        {fundingLabel(row.fundingSource)} · {labels[row.surface]}
      </h3>
      <p className="text-sm text-muted-foreground break-words">{row.label}</p>
      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        {[
          [labels.used, row.used],
          [labels.reserved, row.reserved],
          [labels.remaining, row.remaining],
        ].map(([label, value]) => (
          <div key={label as string} className="min-w-0">
            <dt className="text-muted-foreground">{label as string}</dt>
            <dd className="tabular-nums break-all">
              {figureText(value as ProviderAllocationRow["used"])}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor={id}>
            {labels.limit} ({row.unit === "customer_cents" ? "cents" : row.unit})
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!editable}
            aria-pressed={draft.unlimited}
            onClick={() => change({ ...draft, unlimited: !draft.unlimited })}
          >
            {draft.unlimited ? labels.limited : labels.unlimited}
          </Button>
        </div>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          readOnly={!editable}
          disabled={draft.unlimited}
          value={draft.limit}
          onChange={(event) => change({ ...draft, limit: event.target.value })}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!editable || suggestion === null}
          onClick={() => {
            if (suggestion !== null) change({ limit: suggestion, unlimited: false });
          }}
        >
          {labels.available}
        </Button>
        {suggestion === null && (
          <p className="text-xs text-muted-foreground">
            {available.outcome === "unavailable" ? available.reason : labels.unavailable}
          </p>
        )}
      </div>
      {forecast && (
        <p className="text-sm break-words">
          {labels.forecast}:{" "}
          {forecast.kind === "estimated"
            ? `${labels.estimated} · ${forecast.at}`
            : forecast.kind === "exhausted"
              ? `${labels.exhausted} · ${forecast.at}`
              : forecast.kind === "within_limits"
                ? labels.within
                : forecast.kind === "no_usage"
                  ? labels.noUsage
                  : forecast.reason}
        </p>
      )}
    </section>
  );
}
