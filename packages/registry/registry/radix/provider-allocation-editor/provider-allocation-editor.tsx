"use client";
import { useState } from "react";
import { useProviderAction, useProviderAllocations } from "@usagekit/react";
import { parseProviderDecimal } from "@usagekit/views";
import type { BudgetProjectionInput, ProviderAllocationRow } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ProviderActionFeedback,
  ProviderReadFeedback,
} from "@/components/usagekit/provider-feedback";
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
  revision,
  fresh = false,
  projections,
  labels: custom,
}: {
  rows: readonly ProviderAllocationRow[];
  revision: string;
  fresh?: boolean;
  projections?: Readonly<Record<string, BudgetProjectionInput>>;
  labels?: Partial<ProviderAllocationLabels>;
}) {
  const labels = { ...providerAllocationLabels, ...custom };
  const action = useProviderAction();
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
          row.editable &&
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
    <Card className="min-w-0 w-full">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <AllocationRow
              key={row.id}
              row={row}
              draft={shown(row)}
              editable={editable && row.editable}
              fresh={fresh}
              labels={labels}
              change={(value) => setDrafts({ ...drafts, [row.id]: value })}
              {...(projections?.[row.id] ? { projection: projections[row.id] } : {})}
            />
          ))}
        </div>
        {!rows.length && <p>{labels.empty}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="button"
          disabled={
            !editable ||
            !rows.some(
              (row) =>
                row.editable &&
                (shown(row).unlimited !== initial[row.id]!.unlimited ||
                  (!shown(row).unlimited && shown(row).limit !== initial[row.id]!.limit)),
            )
          }
          onClick={save}
        >
          {labels.save}
        </Button>
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
export function ProviderAllocationPanel({
  connectionIds,
  fresh = false,
  labels,
}: {
  connectionIds: readonly string[];
  fresh?: boolean;
  labels?: Partial<ProviderAllocationLabels>;
}) {
  const result = useProviderAllocations({ connectionIds });
  const action = useProviderAction();
  if (!result.data || result.state !== "ok")
    return (
      <ProviderReadFeedback state={result.state} error={result.error} refresh={result.refresh} />
    );
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={action.pending || action.ambiguous || result.refreshing}
        onClick={() => {
          action.reset();
          result.refresh();
        }}
      >
        Reload allocations
      </Button>
      <ProviderAllocationEditor
        rows={result.data.rows}
        revision={result.data.revision}
        fresh={fresh}
        {...(labels ? { labels } : {})}
      />
    </div>
  );
}
