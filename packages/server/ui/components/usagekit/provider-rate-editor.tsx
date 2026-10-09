"use client";
import { useId, useState } from "react";
import { useProviderAction, useProviderEditor } from "@usagekit/react";
import type { ProviderAction } from "@usagekit/react";
import { parseProviderDecimal } from "@usagekit/views";
import type { Figure, ProviderConnection, ProviderRate } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  centsFromUsd,
  fundingLabel,
  ProviderActionFeedback,
  ProviderReadFeedback,
  ProviderTime,
  usdInput,
  usdText,
} from "@/components/usagekit/provider-feedback";
import {
  UsageChevron,
  UsageNotice,
  UsageReveal,
  UsageSpinner,
  UsageStatus,
  usageMotion,
} from "@/components/usagekit/usage-motion";
import type { UsageTone } from "@/components/usagekit/usage-motion";
export const providerRateLabels = {
  title: "Provider rates",
  description: "Rates retain their source and version. Changing a rate does not change a balance.",
  save: "Save rate",
  /** Clears a manual rate when the host does not say what applies instead. */
  reset: "Clear your rate",
  useMeasured: "Use measured rate",
  useList: "Use list price",
  price: "Price",
  currency: "USD",
  version: "Version",
  checked: "Checked",
  samples: "Samples",
  operation: "Operation",
  funding: "Funding",
  fallback: "Without your rate",
  unknown: "Unknown",
  notSet: "Not set",
  empty: "No rates are available.",
  manual: "Your rate",
  measured: "Measured",
  list: "List price",
  noRate: "No rate yet",
  invalid: "Enter an exact nonnegative price.",
  per: "per",
  reload: "Reload rates",
};
export type ProviderRateLabels = typeof providerRateLabels;
type RateSource = ProviderRate["provenance"]["source"];
const sourceTone: Record<RateSource, UsageTone> = {
  manual: "ok",
  measured: "positive",
  list: "neutral",
  unknown: "unknown",
};
const known = (price: Figure): price is Exclude<Figure, "unavailable"> =>
  price !== "unavailable" && price.certainty !== "unknown";
/** Usagekit money is USD cents, so it reads and edits as dollars; other units stay native. */
const isMoney = (unit: string) => unit === "cents";
function priceText(price: Figure) {
  if (!known(price)) return null;
  return isMoney(price.unit) ? (usdText(price.text) ?? price.text) : `${price.text} ${price.unit}`;
}
function sourceLabel(source: RateSource, labels: ProviderRateLabels) {
  return source === "unknown" ? labels.noRate : labels[source];
}
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
  const money = isMoney(rate.priceUnit);
  // Drafts and pending prices read in the unit the form edits.
  const editText = (native: string) => (money ? (usdInput(native) ?? native) : native);
  const [draft, setDraft] = useState(known(rate.price) ? editText(rate.price.text) : "");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
  const shown = pendingRate
    ? pendingRate.price === null
      ? ""
      : editText(pendingRate.price)
    : draft;
  const save = (text: string | null) => {
    if (!editable) return;
    let price: string | null = null;
    if (text !== null) {
      price = money
        ? centsFromUsd(text)
        : parseProviderDecimal(text, rate.priceUnit).outcome === "valid"
          ? text.trim()
          : null;
      if (price === null) {
        setError(labels.invalid);
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
  const current = evidence ? priceText(evidence.price) : null;
  // Only a manual rate can be cleared, and only then does its fallback matter.
  const fallback = evidence?.provenance.source === "manual" ? evidence.fallback : undefined;
  const manual = evidence?.provenance.source === "manual";
  const reset =
    fallback?.provenance.source === "measured"
      ? labels.useMeasured
      : fallback?.provenance.source === "list"
        ? labels.useList
        : labels.reset;
  return (
    <li className="min-w-0" data-open={open}>
      <div className="-mx-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-details`}
          onClick={() => setOpen(!open)}
          className={`rounded-md py-3.5 hover:bg-muted/60 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-2 text-left ${usageMotion.respond}`}
        >
          {/* Spaces between the parts keep the accessible name readable in every engine. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-sm min-w-0 flex-1 basis-40 break-words font-semibold">
              {rate.label}
            </span>{" "}
            {evidence && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
                {current && (
                  <span className="text-sm tabular-nums">
                    <span className="font-medium">{current}</span>{" "}
                    <span className="text-muted-foreground">
                      {labels.per} {rate.unit}
                    </span>
                  </span>
                )}{" "}
                <UsageStatus tone={sourceTone[evidence.provenance.source]}>
                  {sourceLabel(evidence.provenance.source, labels)}
                </UsageStatus>
              </span>
            )}
          </span>
          <UsageChevron open={open} className="text-muted-foreground" />
        </button>
      </div>
      <UsageReveal open={open} id={`${id}-details`}>
        <div className="gap-4 flex min-w-0 flex-col pb-5 pt-1">
          {evidence && (
            <dl className="rounded-lg bg-muted/50 px-3.5 py-3 text-xs/relaxed grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-x-4 gap-y-3">
              {fallback && (
                <div className="col-span-full min-w-0">
                  <dt className="text-muted-foreground">{labels.fallback}</dt>
                  <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                    <span className="font-medium">
                      {priceText(fallback.price) ?? labels.notSet}
                    </span>{" "}
                    <UsageStatus tone={sourceTone[fallback.provenance.source]}>
                      {sourceLabel(fallback.provenance.source, labels)}
                    </UsageStatus>
                  </dd>
                </div>
              )}
              <div className="min-w-0">
                <dt className="text-muted-foreground">{labels.checked}</dt>
                <dd className="mt-0.5 break-words tabular-nums">
                  {evidence.provenance.checkedAt ? (
                    <ProviderTime value={evidence.provenance.checkedAt} />
                  ) : (
                    labels.unknown
                  )}
                </dd>
              </div>
              {evidence.provenance.sampleSize !== null && (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">{labels.samples}</dt>
                  <dd className="mt-0.5 tabular-nums">{evidence.provenance.sampleSize}</dd>
                </div>
              )}
              {evidence.provenance.version !== null && (
                <div className="min-w-0">
                  <dt className="text-muted-foreground">{labels.version}</dt>
                  <dd className="mt-0.5 break-all">{evidence.provenance.version}</dd>
                </div>
              )}
              <div className="min-w-0">
                <dt className="text-muted-foreground">{labels.operation}</dt>
                <dd className="mt-0.5 break-all">{rate.operation}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">{labels.funding}</dt>
                <dd className="mt-0.5 break-words">{fundingLabel(rate.fundingSource)}</dd>
              </div>
            </dl>
          )}
          {rate.editable && (
            <form
              className="gap-3 flex min-w-0 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                save(draft);
              }}
            >
              <Label htmlFor={id}>
                {labels.price} <span className="sr-only">{rate.label}</span>{" "}
                <span className="font-normal text-muted-foreground">
                  ({money ? labels.currency : rate.priceUnit})
                </span>
              </Label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  id={id}
                  type="text"
                  inputMode="decimal"
                  value={shown}
                  readOnly={!editable}
                  className="min-w-0 flex-1 basis-40 tabular-nums"
                  onChange={(event) => setDraft(event.target.value)}
                  aria-invalid={!!error}
                />
                <Button type="submit" disabled={!editable}>
                  {pendingRate && action.pending && <UsageSpinner />}
                  {labels.save}
                </Button>
                {manual && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!editable}
                    onClick={() => save(null)}
                  >
                    {reset}
                  </Button>
                )}
              </div>
              {error && (
                <UsageNotice key={error} tone="error" role="alert">
                  {error}
                </UsageNotice>
              )}
            </form>
          )}
        </div>
      </UsageReveal>
    </li>
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
          <ul className="m-0 min-w-0 list-none divide-y divide-border border-t border-border p-0">
            {connection.rates.map((rate) => (
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
            ))}
          </ul>
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
