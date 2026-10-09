"use client";
import { useProviderBalance, useProviderProjection } from "@usagekit/react";
import type { ProviderBalance, ProviderProjection, ProviderQuery } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  figureText,
  fundingLabel,
  ProviderReadFeedback,
  ProviderTime,
} from "@/components/usagekit/provider-feedback";
import { UsageSpinner, UsageStatus, usageMotion } from "@/components/usagekit/usage-motion";
export const providerBalanceLabels = {
  title: "Balance",
  balance: "Available balance",
  reserved: "Reserved",
  provider: "Provider account",
  host_wallet: "Host credit wallet",
  unknown: "Unknown authority",
  observed: "Observed",
  stale: "Stale evidence",
  unavailable: "Unavailable",
  reload: "Reload evidence",
  quote: "Request estimate",
  quantity: "Quantity",
  cost: "Provider cost",
  charge: "Customer charge",
  yes: "Can proceed",
  no: "Cannot proceed",
  uncertain: "Unknown",
  availabilityAvailable: "Available",
  availabilityUnavailable: "Not available",
  availabilityUnknown: "Availability unknown",
};
export type ProviderBalanceLabels = typeof providerBalanceLabels;
export function ProviderBalanceCard({
  balance,
  labels: custom,
}: {
  balance: ProviderBalance;
  labels?: Partial<ProviderBalanceLabels>;
}) {
  const labels = { ...providerBalanceLabels, ...custom };
  const availability =
    balance.availability.state === "available"
      ? labels.availabilityAvailable
      : balance.availability.state === "unavailable"
        ? labels.availabilityUnavailable
        : labels.availabilityUnknown;
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <CardTitle className="leading-snug">{labels.title}</CardTitle>
          {balance.freshness.stale && <Badge variant="outline">{labels.stale}</Badge>}
        </div>
        <CardDescription className="flex flex-wrap gap-x-2">
          <span>{labels[balance.authority]}</span>
          <span>{fundingLabel(balance.fundingSource)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="cn-usage-gap-md flex flex-col">
        <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
          {[
            [labels.balance, balance.balance],
            [labels.reserved, balance.reserved],
          ].map(([title, value]) => (
            <div key={title as string} className="min-w-0">
              <dt className="cn-usage-label text-muted-foreground">{title as string}</dt>
              <dd
                key={figureText(value as ProviderBalance["balance"])}
                className={`cn-usage-figure-md mt-1 break-all font-semibold tabular-nums ${usageMotion.enter}`}
              >
                {figureText(value as ProviderBalance["balance"])}
              </dd>
            </div>
          ))}
        </dl>
        <UsageStatus
          tone={
            balance.availability.state === "available"
              ? "positive"
              : balance.availability.state === "unavailable"
                ? "exceeded"
                : "unknown"
          }
        >
          {availability}
        </UsageStatus>
        {balance.availability.reason && (
          <p className="cn-usage-body break-words">{balance.availability.reason}</p>
        )}
        <p className="cn-usage-meta break-all text-muted-foreground tabular-nums">
          {labels.observed}:{" "}
          {balance.freshness.observedAt ? (
            <ProviderTime value={balance.freshness.observedAt} />
          ) : (
            labels.unavailable
          )}
        </p>
      </CardContent>
    </Card>
  );
}
export function ProviderBalancePanel({
  connectionId,
  labels,
}: {
  connectionId: string;
  labels?: Partial<ProviderBalanceLabels>;
}) {
  const result = useProviderBalance({ connectionId });
  if (!result.data?.balance || result.state !== "ok")
    return (
      <ProviderReadFeedback state={result.state} error={result.error} refresh={result.refresh} />
    );
  return (
    <div className="space-y-3">
      <ProviderBalanceCard balance={result.data.balance} {...(labels ? { labels } : {})} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={result.refreshing}
        onClick={result.refresh}
      >
        {result.refreshing && <UsageSpinner />}
        {labels?.reload ?? providerBalanceLabels.reload}
      </Button>
    </div>
  );
}
export function ProviderRequestQuote({
  projection,
  labels: custom,
}: {
  projection: ProviderProjection;
  labels?: Partial<ProviderBalanceLabels>;
}) {
  const labels = { ...providerBalanceLabels, ...custom };
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <CardTitle className="leading-snug">{labels.quote}</CardTitle>
          <UsageStatus
            tone={
              projection.canProceed === "unknown"
                ? "unknown"
                : projection.canProceed === "yes"
                  ? "positive"
                  : "exceeded"
            }
          >
            {projection.canProceed === "unknown" ? labels.uncertain : labels[projection.canProceed]}
          </UsageStatus>
        </div>
        {projection.reason && <CardDescription>{projection.reason}</CardDescription>}
      </CardHeader>
      <CardContent>
        <dl className="min-w-0 divide-y divide-border">
          {[
            [labels.quantity, projection.quantity],
            [labels.cost, projection.providerCost],
            [labels.charge, projection.customerCharge],
          ].map(([title, value]) => (
            <div
              key={title as string}
              className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
            >
              <dt className="cn-usage-body text-muted-foreground">{title as string}</dt>
              <dd className="cn-usage-value break-all font-medium tabular-nums">
                {figureText(value as ProviderProjection["quantity"])}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
export function ProviderRequestQuotePanel({
  query,
  labels,
}: {
  query: Extract<ProviderQuery, { kind: "projection" }>;
  labels?: Partial<ProviderBalanceLabels>;
}) {
  const result = useProviderProjection(query);
  if (!result.data?.projection || result.state !== "ok")
    return (
      <ProviderReadFeedback state={result.state} error={result.error} refresh={result.refresh} />
    );
  return (
    <ProviderRequestQuote projection={result.data.projection} {...(labels ? { labels } : {})} />
  );
}
