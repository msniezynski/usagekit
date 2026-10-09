"use client";
import { useId, useState } from "react";
import { useProviderAction, useProviderEditor } from "@usagekit/react";
import type { ProviderAction } from "@usagekit/react";
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
  ProviderReadFeedback,
  ProviderTime,
} from "@/components/usagekit/provider-feedback";
import { UsageNotice, UsageSpinner } from "@/components/usagekit/usage-motion";
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
  current: "Current",
  per: "per",
  reload: "Reload rates",
};
export type ProviderRateLabels = typeof providerRateLabels;
function RateRow({
  connection,
  rate,
  evidence,
  action,
  labels,
}: {
  connection: ProviderConnection;
  rate: ProviderRate;
  evidence: ProviderRate | null;
  action: ProviderAction;
  labels: ProviderRateLabels;
}) {
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
    evidence?.editable === true &&
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
    <div className="rounded-md border px-4 py-3.5 gap-4 flex min-w-0 flex-col border-border">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="font-medium">{rate.label}</h3>
          <p className="text-sm flex flex-wrap gap-x-2 break-words text-muted-foreground">
            <span>{rate.operation}</span>
            <span>{fundingLabel(rate.fundingSource)}</span>
          </p>
        </div>
        <p className="text-sm text-right tabular-nums">
          {evidence ? (
            <>
              <span className="font-semibold">{figureText(evidence.price)}</span>{" "}
              <span className="text-muted-foreground">
                {labels.per} {rate.unit}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {labels.per} {rate.unit}
            </span>
          )}
        </p>
      </div>
      {evidence && (
        <dl className="rounded-lg bg-muted/50 px-3.5 py-3 text-xs/relaxed grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.source}</dt>
            <dd className="mt-0.5 break-words">
              {evidence.provenance.source === "unknown"
                ? labels.unknown
                : labels[evidence.provenance.source]}
              <span className="block text-muted-foreground">{evidence.provenance.origin}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.version}</dt>
            <dd className="mt-0.5 break-all">{evidence.provenance.version ?? labels.unknown}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.checked}</dt>
            <dd className="mt-0.5 break-all tabular-nums">
              {evidence.provenance.checkedAt ? (
                <ProviderTime value={evidence.provenance.checkedAt} />
              ) : (
                labels.unknown
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{labels.samples}</dt>
            <dd className="mt-0.5 tabular-nums">
              {evidence.provenance.sampleSize ?? labels.unknown}
            </dd>
          </div>
        </dl>
      )}
      {rate.editable && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={id}>
              {labels.price} <span className="sr-only">{rate.label}</span>{" "}
              <span className="font-normal text-muted-foreground">({rate.priceUnit})</span>
            </Label>
            <Input
              id={id}
              type="text"
              inputMode="decimal"
              value={shown}
              readOnly={!editable}
              className="tabular-nums"
              onChange={(event) => setDraft(event.target.value)}
              aria-invalid={!!error}
            />
          </div>
          {error && (
            <UsageNotice key={error} tone="error" role="alert">
              {error}
            </UsageNotice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!editable}>
              {pendingRate && action.pending && <UsageSpinner />}
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
  evidence = connection,
  action: guardedAction,
  labels: custom,
}: {
  connection: ProviderConnection;
  /** Omit for explicit-data presentation; panels supply current evidence or null. */
  evidence?: ProviderConnection | null;
  action?: ProviderAction;
  labels?: Partial<ProviderRateLabels>;
}) {
  const labels = { ...providerRateLabels, ...custom };
  const sharedAction = useProviderAction();
  const suppliedAction = guardedAction ?? sharedAction;
  const action = {
    ...suppliedAction,
    canWrite: suppliedAction.canWrite && evidence?.capabilities.includes("rates") === true,
  };
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle className="leading-snug">{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="gap-4 flex flex-col">
        {connection.rates.length ? (
          connection.rates.map((rate) => (
            <RateRow
              key={`${rate.id}:${connection.revision}`}
              connection={connection}
              rate={rate}
              evidence={
                evidence?.id === connection.id && evidence.provider === connection.provider
                  ? (evidence.rates.find(
                      (value) =>
                        value.id === rate.id &&
                        value.operation === rate.operation &&
                        value.priceUnit === rate.priceUnit &&
                        value.unit === rate.unit &&
                        value.fundingSource === rate.fundingSource,
                    ) ?? null)
                  : null
              }
              action={action}
              labels={labels}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{labels.empty}</p>
        )}
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
export function ProviderRatePanel({
  connectionId,
  labels,
  evidenceAvailable = true,
  canEdit = true,
}: {
  connectionId: string;
  labels?: Partial<ProviderRateLabels>;
  evidenceAvailable?: boolean;
  canEdit?: boolean;
}) {
  const result = useProviderEditor({ kind: "details", connectionId });
  const action = { ...result.action, canWrite: result.canEdit && canEdit && evidenceAvailable };
  const disabled = action.pending || action.ambiguous || result.refreshing || !evidenceAvailable;
  if (!result.editorData?.connection)
    return (
      <ProviderReadFeedback
        state={result.state}
        error={result.error}
        refresh={result.reload}
        disabled={disabled}
      />
    );
  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={result.reload}>
        {result.refreshing && <UsageSpinner />}
        {labels?.reload ?? providerRateLabels.reload}
      </Button>
      {!result.evidence && (
        <ProviderReadFeedback
          state={result.state}
          error={result.error}
          refresh={result.reload}
          disabled={disabled}
        />
      )}
      <ProviderRateEditor
        key={result.editorEpoch}
        connection={result.editorData.connection}
        evidence={evidenceAvailable ? (result.evidence?.connection ?? null) : null}
        action={action}
        {...(labels ? { labels } : {})}
      />
    </div>
  );
}
