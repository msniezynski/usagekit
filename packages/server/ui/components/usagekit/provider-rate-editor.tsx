"use client";
import { useId, useState } from "react";
import { useProviderAction } from "@usagekit/react";
import { parseProviderDecimal } from "@usagekit/views";
import type { ProviderConnection, ProviderRate } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  figureText,
  fundingLabel,
  ProviderActionFeedback,
} from "@/components/usagekit/provider-feedback";
export const providerRateLabels = {
  title: "Provider rates",
  description: "Rates retain their source and version. Changing a rate does not change a balance.",
  save: "Save rate",
  reset: "Use host rate",
  price: "Price",
  source: "Source",
  version: "Version",
  checked: "Checked",
  samples: "Samples",
  unknown: "Unknown",
  empty: "No rates are available.",
  manual: "Manual",
  measured: "Measured",
  list: "List",
  invalid: "Enter an exact nonnegative price.",
};
export type ProviderRateLabels = typeof providerRateLabels;
function RateRow({
  connection,
  rate,
  labels,
}: {
  connection: ProviderConnection;
  rate: ProviderRate;
  labels: ProviderRateLabels;
}) {
  const action = useProviderAction();
  const id = useId();
  const [draft, setDraft] = useState(
    rate.price === "unavailable" || rate.price.certainty === "unknown" ? "" : rate.price.text,
  );
  const [error, setError] = useState<string | null>(null);
  const editable =
    action.canWrite &&
    !action.pending &&
    !action.ambiguous &&
    action.state !== "conflict" &&
    rate.editable &&
    connection.capabilities.includes("rates");
  const submitted = action.submittedCommand;
  const pendingRate =
    (action.pending || action.ambiguous) &&
    submitted?.kind === "rates" &&
    submitted.connectionId === connection.id
      ? submitted.rates.find((value) => value.rateId === rate.id)
      : null;
  const shown = pendingRate ? (pendingRate.price ?? "") : draft;
  const save = (price: string | null) => {
    if (!editable) return;
    if (price !== null) {
      const parsed = parseProviderDecimal(price, rate.priceUnit);
      if (parsed.outcome === "invalid") {
        setError(parsed.reason);
        return;
      }
    }
    setError(null);
    void action.run({
      kind: "rates",
      commandId: crypto.randomUUID(),
      connectionId: connection.id,
      expectedRevision: connection.revision,
      rates: [{ rateId: rate.id, price }],
    });
  };
  return (
    <div className="space-y-3 rounded-lg border border-border p-4 min-w-0">
      <div>
        <h3 className="font-medium">{rate.label}</h3>
        <p className="text-sm text-muted-foreground break-words">
          {rate.operation} · {fundingLabel(rate.fundingSource)} · {figureText(rate.price)} /{" "}
          {rate.unit}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt>{labels.source}</dt>
          <dd>
            {rate.provenance.source === "unknown" ? labels.unknown : labels[rate.provenance.source]}{" "}
            · {rate.provenance.origin}
          </dd>
        </div>
        <div>
          <dt>{labels.version}</dt>
          <dd className="break-all">{rate.provenance.version ?? labels.unknown}</dd>
        </div>
        <div>
          <dt>{labels.checked}</dt>
          <dd className="break-all">{rate.provenance.checkedAt ?? labels.unknown}</dd>
        </div>
        <div>
          <dt>{labels.samples}</dt>
          <dd>{rate.provenance.sampleSize ?? labels.unknown}</dd>
        </div>
      </dl>
      {rate.editable && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft);
          }}
        >
          <Label htmlFor={id}>
            {labels.price} · {rate.label}
          </Label>
          <Input
            id={id}
            type="text"
            inputMode="decimal"
            value={shown}
            readOnly={!editable}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!!error}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!editable}>
              {labels.save}
            </Button>
            <Button type="button" variant="outline" disabled={!editable} onClick={() => save(null)}>
              {labels.reset}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
export function ProviderRateEditor({
  connection,
  labels: custom,
}: {
  connection: ProviderConnection;
  labels?: Partial<ProviderRateLabels>;
}) {
  const labels = { ...providerRateLabels, ...custom };
  const action = useProviderAction();
  return (
    <Card className="min-w-0 w-full">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connection.rates.length ? (
          connection.rates.map((rate) => (
            <RateRow
              key={`${rate.id}:${connection.revision}`}
              connection={connection}
              rate={rate}
              labels={labels}
            />
          ))
        ) : (
          <p>{labels.empty}</p>
        )}
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
