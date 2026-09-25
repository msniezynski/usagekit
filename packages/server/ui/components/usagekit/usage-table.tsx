"use client";

import { useState } from "react";
import type { Certainty, UsageQuery } from "@usagekit/core";
import { useUsageView } from "@usagekit/react";
import type { Amount, Figure, UsageView } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const usageTableLabels = {
  cost: "Cost",
  certainty: "Certainty",
  unknownOperations: "Unknown operations",
  measured: "Measured",
  estimated: "Estimated",
  unknown: "Unknown",
  unavailable: "Unavailable",
  loading: "Loading usage.",
  empty: "No usage in this period.",
  forbidden: "You cannot view usage for this scope.",
  failed: "Usage is unavailable right now.",
  next: "Next page",
  first: "First page",
};
export type UsageTableLabels = typeof usageTableLabels;

const certaintyVariant = {
  measured: "secondary",
  estimated: "outline",
  unknown: "outline",
} as const;

function figure(value: Figure | Amount, labels: UsageTableLabels): string {
  if (value === "unavailable") return labels.unavailable;
  if (value.certainty === "unknown") return labels.unknown;
  return `${value.text} ${value.unit}`;
}
function CertaintyBadge({ value, labels }: { value: Certainty; labels: UsageTableLabels }) {
  return (
    <Badge
      variant={certaintyVariant[value]}
      className={value === "unknown" ? "text-muted-foreground" : undefined}
    >
      {labels[value]}
    </Badge>
  );
}

export type UsageTableProps = {
  view: UsageView | null;
  labels?: Partial<UsageTableLabels>;
  /** Column headings per dimension; the dimension name is the default. */
  dimensionLabels?: Partial<Record<string, string>>;
  onNextPage?: (cursor: string) => void;
  onFirstPage?: () => void;
};

/** Renders one UsageView page. Amounts are the view model's exact text, never recomputed. */
export function UsageTable({
  view,
  labels: custom,
  dimensionLabels = {},
  onNextPage,
  onFirstPage,
}: UsageTableProps) {
  const labels = { ...usageTableLabels, ...custom };
  if (!view) return <p className="text-sm text-muted-foreground">{labels.loading}</p>;
  if (view.state === "forbidden" || view.state === "unavailable")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {view.state === "forbidden" ? labels.forbidden : labels.failed}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            {view.groupBy.map((d) => (
              <TableHead key={d}>{dimensionLabels[d] ?? d}</TableHead>
            ))}
            {view.units.map((unit) => (
              <TableHead key={unit} className="text-right">
                {unit}
              </TableHead>
            ))}
            <TableHead className="text-right">{labels.cost}</TableHead>
            <TableHead>{labels.certainty}</TableHead>
            <TableHead className="text-right">{labels.unknownOperations}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.state === "empty" ? (
            <TableRow>
              <TableCell
                colSpan={view.groupBy.length + view.units.length + 3}
                className="text-center text-muted-foreground"
              >
                {labels.empty}
              </TableCell>
            </TableRow>
          ) : (
            view.rows.map((row) => (
              <TableRow key={row.key}>
                {view.groupBy.map((d) => (
                  <TableCell key={d}>{row.dimensions[d] ?? ""}</TableCell>
                ))}
                {view.units.map((unit) => (
                  <TableCell key={unit} className="text-right tabular-nums">
                    {figure(row.units[unit] ?? "unavailable", labels)}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {figure(row.cost, labels)}
                </TableCell>
                <TableCell>
                  <CertaintyBadge value={row.certainty} labels={labels} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.unknownOperations}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {(onFirstPage || (onNextPage && view.nextCursor)) && (
        <div className="flex justify-end gap-2">
          {onFirstPage && (
            <Button variant="outline" size="sm" onClick={onFirstPage}>
              {labels.first}
            </Button>
          )}
          {onNextPage && view.nextCursor && (
            <Button variant="outline" size="sm" onClick={() => onNextPage(view.nextCursor!)}>
              {labels.next}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Reads the view with useUsageView inside a MeterProvider and pages with the cursor. */
export function UsageTablePanel({
  labels,
  dimensionLabels,
  ...query
}: Omit<UsageQuery, "cursor"> & Pick<UsageTableProps, "labels" | "dimensionLabels">) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const result = useUsageView(cursor ? { ...query, cursor } : query);
  return (
    <UsageTable
      view={result.data}
      labels={labels}
      dimensionLabels={dimensionLabels}
      onNextPage={setCursor}
      onFirstPage={cursor ? () => setCursor(undefined) : undefined}
    />
  );
}
