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
} from "@/components/usagekit/provider-feedback";
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
  return (
    <Card className="min-w-0 w-full">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>
          {labels[balance.authority]} · {fundingLabel(balance.fundingSource)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          {[
            [labels.balance, balance.balance],
            [labels.reserved, balance.reserved],
          ].map(([title, value]) => (
            <div key={title as string} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{title as string}</dt>
              <dd className="text-xl font-semibold tabular-nums break-all">
                {figureText(value as ProviderBalance["balance"])}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{balance.availability.state}</Badge>
          {balance.freshness.stale && <Badge variant="outline">{labels.stale}</Badge>}
        </div>
        {balance.availability.reason && (
          <p className="text-sm break-words">{balance.availability.reason}</p>
        )}
        <p className="text-xs text-muted-foreground break-all">
          {labels.observed}: {balance.freshness.observedAt ?? labels.unavailable}
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
    <div className="space-y-2">
      <ProviderBalanceCard balance={result.data.balance} {...(labels ? { labels } : {})} />
      <Button type="button" variant="outline" disabled={result.refreshing} onClick={result.refresh}>
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
    <Card className="min-w-0 w-full">
      <CardHeader>
        <CardTitle>{labels.quote}</CardTitle>
        <CardDescription>{projection.reason}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-3">
          {[
            [labels.quantity, projection.quantity],
            [labels.cost, projection.providerCost],
            [labels.charge, projection.customerCharge],
          ].map(([title, value]) => (
            <div key={title as string} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{title as string}</dt>
              <dd className="break-all tabular-nums">
                {figureText(value as ProviderProjection["quantity"])}
              </dd>
            </div>
          ))}
        </dl>
        <Badge variant="outline">
          {projection.canProceed === "unknown" ? labels.uncertain : labels[projection.canProceed]}
        </Badge>
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
