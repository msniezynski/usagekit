"use client";
import { useId } from "react";
import { allocationLimitFromAvailable, projectBudgetExhaustion } from "@usagekit/views";
import type { BudgetProjectionInput, ProviderAllocationRow } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { figureText, fundingLabel } from "@/components/usagekit/provider-feedback";
import { UsageStatus, usageMotion } from "@/components/usagekit/usage-motion";
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
  reload: "Reload allocations",
};
export type ProviderAllocationLabels = typeof providerAllocationLabels;
export type Draft = { limit: string; unlimited: boolean };
export function AllocationRow({
  row,
  evidence = row,
  draft,
  change,
  editable,
  fresh,
  labels,
  projection,
}: {
  row: ProviderAllocationRow;
  /** Current evidence only. Null preserves the draft without displaying retained figures. */
  evidence?: ProviderAllocationRow | null;
  draft: Draft;
  change: (value: Draft) => void;
  editable: boolean;
  fresh: boolean;
  labels: ProviderAllocationLabels;
  projection?: BudgetProjectionInput;
}) {
  const id = useId();
  const available =
    fresh && evidence?.available && evidence.availabilityBasis
      ? allocationLimitFromAvailable({
          used: evidence.used,
          reserved: evidence.reserved,
          available: evidence.available,
          availabilityBasis: evidence.availabilityBasis,
        })
      : { outcome: "unavailable" as const, reason: labels.unavailable };
  const suggestion =
    available.outcome === "ready" && available.limit.unit === row.unit
      ? available.limit.text
      : null;
  const forecast = evidence && projection ? projectBudgetExhaustion(projection) : null;
  return (
    <section
      aria-label={`${fundingLabel(row.fundingSource)} ${labels[row.surface]}`}
      className="cn-usage-item cn-usage-gap-md flex min-w-0 flex-col border-border"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 className="cn-usage-title font-medium">
          {fundingLabel(row.fundingSource)}
          <span className="text-muted-foreground"> {labels[row.surface]}</span>
        </h3>
        <p className="cn-usage-body break-words text-muted-foreground">{row.label}</p>
      </div>
      {evidence && (
        <dl className="cn-usage-well cn-usage-body grid min-w-0 grid-cols-3 gap-3">
          {[
            [labels.used, evidence.used],
            [labels.reserved, evidence.reserved],
            [labels.remaining, evidence.remaining],
          ].map(([label, value]) => (
            <div key={label as string} className="min-w-0">
              <dt className="cn-usage-label text-muted-foreground">{label as string}</dt>
              <dd
                key={figureText(value as ProviderAllocationRow["used"])}
                className={`mt-0.5 break-all font-medium tabular-nums ${usageMotion.enter}`}
              >
                {figureText(value as ProviderAllocationRow["used"])}
              </dd>
            </div>
          ))}
        </dl>
      )}
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
          className="tabular-nums"
          onChange={(event) => change({ ...draft, limit: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
            <p className="cn-usage-meta min-w-0 flex-1 basis-48 text-muted-foreground">
              {available.outcome === "unavailable" ? available.reason : labels.unavailable}
            </p>
          )}
        </div>
      </div>
      {forecast && (
        <div className="cn-usage-body flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3">
          <span className="text-muted-foreground">{labels.forecast}</span>
          <UsageStatus
            tone={
              forecast.kind === "exhausted"
                ? "exceeded"
                : forecast.kind === "estimated"
                  ? "warning"
                  : forecast.kind === "within_limits"
                    ? "positive"
                    : "neutral"
            }
          >
            {forecast.kind === "estimated"
              ? `${labels.estimated} ${forecast.at}`
              : forecast.kind === "exhausted"
                ? `${labels.exhausted} ${forecast.at}`
                : forecast.kind === "within_limits"
                  ? labels.within
                  : forecast.kind === "no_usage"
                    ? labels.noUsage
                    : forecast.reason}
          </UsageStatus>
        </div>
      )}
    </section>
  );
}
