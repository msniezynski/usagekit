"use client";
import { useProviderAction, useProviderEditor } from "@usagekit/react";
import type { ProviderAction } from "@usagekit/react";
import type { ProviderConnection } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ProviderActionFeedback,
  ProviderReadFeedback,
  providerFeedbackLabels,
} from "@/components/usagekit/provider-feedback";
import type { ProviderFeedbackLabels } from "@/components/usagekit/provider-feedback";
import { ProviderRateRow } from "@/components/usagekit/provider-rate-row";
import { UsageSpinner } from "@/components/usagekit/usage-motion";
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
export function ProviderRateEditor({
  connection,
  evidence = connection,
  action: guardedAction,
  labels: custom,
  feedbackLabels,
}: {
  connection: ProviderConnection;
  /** Omit for explicit-data presentation; panels supply current evidence or null. */
  evidence?: ProviderConnection | null;
  action?: ProviderAction;
  labels?: Partial<ProviderRateLabels>;
  /** Status, funding and recovery copy shared with the other provider blocks. */
  feedbackLabels?: Partial<ProviderFeedbackLabels>;
}) {
  const labels = { ...providerRateLabels, ...custom };
  const feedback = { ...providerFeedbackLabels, ...feedbackLabels };
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
      <CardContent className="cn-usage-gap-md flex flex-col">
        {connection.rates.length ? (
          <ul className="m-0 min-w-0 list-none divide-y divide-border border-t border-border p-0">
            {connection.rates.map((rate) => (
              <ProviderRateRow
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
                feedback={feedback}
              />
            ))}
          </ul>
        ) : (
          <p className="cn-usage-body text-muted-foreground">{labels.empty}</p>
        )}
        <ProviderActionFeedback action={action} labels={feedback} />
      </CardContent>
    </Card>
  );
}
export function ProviderRatePanel({
  connectionId,
  labels,
  feedbackLabels,
  evidenceAvailable = true,
  canEdit = true,
  onReload,
}: {
  connectionId: string;
  labels?: Partial<ProviderRateLabels>;
  feedbackLabels?: Partial<ProviderFeedbackLabels>;
  evidenceAvailable?: boolean;
  canEdit?: boolean;
  /** Runs first on every explicit reload, such as reverifying the host's access grant. */
  onReload?: () => void;
}) {
  const result = useProviderEditor({ kind: "details", connectionId });
  const action = { ...result.action, canWrite: result.canEdit && canEdit && evidenceAvailable };
  const disabled = action.pending || action.ambiguous || result.refreshing || !evidenceAvailable;
  // The host goes first, so a read it starts cannot outrun the reload that rebases the form.
  const reload = () => {
    onReload?.();
    result.reload();
  };
  if (!result.editorData?.connection)
    return (
      <ProviderReadFeedback
        state={result.state}
        error={result.error}
        refresh={reload}
        disabled={disabled}
        {...(feedbackLabels ? { labels: feedbackLabels } : {})}
      />
    );
  // A refused change already says so in the action feedback; the hidden evidence need not repeat it.
  const repeated = action.state === "forbidden" && result.state === "forbidden";
  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={reload}>
        {result.refreshing && <UsageSpinner />}
        {labels?.reload ?? providerRateLabels.reload}
      </Button>
      {!result.evidence && !repeated && (
        <ProviderReadFeedback
          state={result.state}
          error={result.error}
          refresh={reload}
          disabled={disabled}
          {...(feedbackLabels ? { labels: feedbackLabels } : {})}
        />
      )}
      <ProviderRateEditor
        key={result.editorEpoch}
        connection={result.editorData.connection}
        evidence={evidenceAvailable ? (result.evidence?.connection ?? null) : null}
        action={action}
        {...(labels ? { labels } : {})}
        {...(feedbackLabels ? { feedbackLabels } : {})}
      />
    </div>
  );
}
