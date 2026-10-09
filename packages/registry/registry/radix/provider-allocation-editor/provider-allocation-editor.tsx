"use client";
import { useState } from "react";
import { useProviderAction, useProviderEditor } from "@usagekit/react";
import type { ProviderAction } from "@usagekit/react";
import { parseProviderDecimal } from "@usagekit/views";
import type { BudgetProjectionInput, ProviderAllocationRow } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ProviderActionFeedback,
  ProviderReadFeedback,
} from "@/components/usagekit/provider-feedback";
import { UsageNotice, UsageSpinner } from "@/components/usagekit/usage-motion";
import {
  AllocationRow,
  providerAllocationLabels,
} from "@/components/usagekit/provider-allocation-row";
import type {
  Draft,
  ProviderAllocationLabels,
} from "@/components/usagekit/provider-allocation-row";
export { providerAllocationLabels } from "@/components/usagekit/provider-allocation-row";
type AllocationProps = {
  rows: readonly ProviderAllocationRow[];
  /** Omit for explicit-data presentation; panels supply current evidence or null. */
  evidenceRows?: readonly ProviderAllocationRow[] | null;
  action?: ProviderAction;
  revision: string;
  fresh?: boolean;
  projections?: Readonly<Record<string, BudgetProjectionInput>>;
  labels?: Partial<ProviderAllocationLabels>;
};
export function ProviderAllocationEditor(props: AllocationProps) {
  const identity = JSON.stringify([
    props.revision,
    props.rows.map((row) => [
      row.id,
      row.revision,
      row.connectionId,
      row.fundingSource,
      row.surface,
      row.unit,
      row.limit,
      row.unlimited,
      row.editable,
    ]),
  ]);
  return <AllocationEditor key={identity} {...props} />;
}
function AllocationEditor({
  rows,
  evidenceRows = rows,
  action: guardedAction,
  revision,
  fresh = false,
  projections,
  labels: custom,
}: AllocationProps) {
  const labels = { ...providerAllocationLabels, ...custom };
  const sharedAction = useProviderAction();
  const action = guardedAction ?? sharedAction;
  const initial = Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        limit:
          row.limit === "unavailable" || row.limit.certainty === "unknown" ? "" : row.limit.text,
        unlimited: row.unlimited,
      },
    ]),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);
  const [error, setError] = useState<string | null>(null);
  const editable =
    action.canWrite && !action.pending && !action.ambiguous && action.state !== "conflict";
  const current = (row: ProviderAllocationRow) =>
    evidenceRows?.find(
      (value) =>
        value.id === row.id &&
        value.connectionId === row.connectionId &&
        value.fundingSource === row.fundingSource &&
        value.surface === row.surface &&
        value.unit === row.unit,
    ) ?? null;
  const mayEdit = (row: ProviderAllocationRow) =>
    editable && row.editable && current(row)?.editable === true;
  const submitted = action.submittedCommand;
  const shown = (row: ProviderAllocationRow): Draft => {
    const pending =
      (action.pending || action.ambiguous) && submitted?.kind === "allocations"
        ? submitted.changes.find((change) => change.rowId === row.id)
        : null;
    return pending && pending.limit !== undefined
      ? { unlimited: pending.limit === null, limit: pending.limit ?? "" }
      : (drafts[row.id] ?? initial[row.id]!);
  };
  const save = () => {
    if (!editable) return;
    const changes = rows
      .filter(
        (row) =>
          mayEdit(row) &&
          (shown(row).unlimited !== initial[row.id]!.unlimited ||
            (!shown(row).unlimited && shown(row).limit !== initial[row.id]!.limit)),
      )
      .map((row) => ({
        rowId: row.id,
        expectedRevision: row.revision,
        limit: shown(row).unlimited ? null : shown(row).limit,
      }));
    for (const change of changes) {
      if (change.limit !== null) {
        const row = rows.find((row) => row.id === change.rowId)!;
        const result = parseProviderDecimal(change.limit, row.unit);
        if (result.outcome === "invalid") {
          setError(`${row.label}: ${result.reason}`);
          return;
        }
      }
    }
    setError(null);
    void action.run({
      kind: "allocations",
      commandId: crypto.randomUUID(),
      expectedRevision: revision,
      changes,
    });
  };
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle className="leading-snug">{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="cn-usage-gap-md flex flex-col">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <AllocationRow
              key={row.id}
              row={row}
              evidence={current(row)}
              draft={shown(row)}
              editable={mayEdit(row)}
              fresh={fresh}
              labels={labels}
              change={(value) => setDrafts({ ...drafts, [row.id]: value })}
              {...(projections?.[row.id] ? { projection: projections[row.id] } : {})}
            />
          ))}
        </div>
        {!rows.length && (
          <p className="cn-usage-empty cn-usage-body border-border text-muted-foreground">
            {labels.empty}
          </p>
        )}
        {error && (
          <UsageNotice key={error} tone="error" role="alert">
            {error}
          </UsageNotice>
        )}
        <div className="border-t border-border pt-4">
          <Button
            type="button"
            disabled={
              !editable ||
              !rows.some(
                (row) =>
                  mayEdit(row) &&
                  (shown(row).unlimited !== initial[row.id]!.unlimited ||
                    (!shown(row).unlimited && shown(row).limit !== initial[row.id]!.limit)),
              )
            }
            onClick={save}
          >
            {action.pending && submitted?.kind === "allocations" && <UsageSpinner />}
            {labels.save}
          </Button>
        </div>
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
export function ProviderAllocationPanel({
  connectionIds,
  fresh = false,
  labels,
  evidenceAvailable = true,
  canEdit = true,
}: {
  connectionIds: readonly string[];
  fresh?: boolean;
  labels?: Partial<ProviderAllocationLabels>;
  /** A composing panel may withdraw evidence without discarding this editor's draft. */
  evidenceAvailable?: boolean;
  canEdit?: boolean;
}) {
  const result = useProviderEditor({ kind: "allocations", connectionIds });
  const action = { ...result.action, canWrite: result.canEdit && canEdit && evidenceAvailable };
  const reloadDisabled =
    action.pending || action.ambiguous || result.refreshing || !evidenceAvailable;
  if (!result.editorData)
    return (
      <ProviderReadFeedback
        state={result.state}
        error={result.error}
        refresh={result.reload}
        disabled={reloadDisabled}
      />
    );
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={reloadDisabled}
        onClick={result.reload}
      >
        {result.refreshing && <UsageSpinner />}
        {labels?.reload ?? providerAllocationLabels.reload}
      </Button>
      {!result.evidence && (
        <ProviderReadFeedback
          state={result.state}
          error={result.error}
          refresh={result.reload}
          disabled={reloadDisabled}
        />
      )}
      <ProviderAllocationEditor
        key={result.editorEpoch}
        rows={result.editorData.rows}
        revision={result.editorData.revision}
        evidenceRows={evidenceAvailable ? (result.evidence?.rows ?? null) : null}
        action={action}
        fresh={fresh}
        {...(labels ? { labels } : {})}
      />
    </div>
  );
}
