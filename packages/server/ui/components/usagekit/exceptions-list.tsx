"use client";

import { useExceptionsView } from "@usagekit/react";
import type { ExceptionKind, ExceptionsInput, ExceptionsView } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const exceptionsListLabels = {
  title: "Needs attention",
  operation: "Operation",
  provider: "Provider",
  principal: "Principal",
  kind: "Exception",
  state: "State",
  age: "Age",
  reservation_expired: "Reservation expired",
  lease_expired: "Lease expired",
  pending: "Pending evidence",
  loading: "Loading exceptions.",
  empty: "No exceptions in this period.",
  forbidden: "You cannot view operations for this scope.",
  failed: "Exceptions are unavailable right now.",
};
export type ExceptionsListLabels = typeof exceptionsListLabels;

const kindVariant = {
  lease_expired: "destructive",
  reservation_expired: "outline",
  pending: "secondary",
} as const;

/** Seconds, minutes, hours or days; hosts pass formatAge for their own language. */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} d`;
}

export type ExceptionsListProps = {
  view: ExceptionsView | null;
  labels?: Partial<ExceptionsListLabels>;
  formatAge?: (seconds: number) => string;
};

/** Operations that need attention, with their lifecycle state and age at the view's asOf. */
export function ExceptionsList({
  view,
  labels: custom,
  formatAge: age = formatAge,
}: ExceptionsListProps) {
  const labels = { ...exceptionsListLabels, ...custom };
  if (!view) return <p className="text-sm text-muted-foreground">{labels.loading}</p>;
  if (view.state === "forbidden" || view.state === "unavailable")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {view.state === "forbidden" ? labels.forbidden : labels.failed}
      </p>
    );
  return (
    <Table
      tabIndex={0}
      aria-label={labels.title}
      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
    >
      <TableHeader>
        <TableRow>
          <TableHead>{labels.operation}</TableHead>
          <TableHead>{labels.provider}</TableHead>
          <TableHead>{labels.principal}</TableHead>
          <TableHead>{labels.kind}</TableHead>
          <TableHead>{labels.state}</TableHead>
          <TableHead className="text-right">{labels.age}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              {labels.empty}
            </TableCell>
          </TableRow>
        ) : (
          view.rows.map((row) => (
            <TableRow key={row.operationId} data-kind={row.kind}>
              <TableCell className="font-mono text-xs">{row.operationId}</TableCell>
              <TableCell>{`${row.provider} ${row.operation}`}</TableCell>
              <TableCell>{row.principal}</TableCell>
              <TableCell>
                <Badge variant={kindVariant[row.kind]}>{labels[row.kind as ExceptionKind]}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{row.state}</TableCell>
              <TableCell className="text-right tabular-nums">{age(row.ageSeconds)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

/** Reads exceptions with useExceptionsView inside a MeterProvider. */
export function ExceptionsListPanel({
  labels,
  formatAge: age,
  ...input
}: ExceptionsInput & Pick<ExceptionsListProps, "labels" | "formatAge">) {
  const result = useExceptionsView(input);
  if (result.state === "unavailable" || result.state === "forbidden")
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {result.state === "forbidden"
          ? (labels?.forbidden ?? exceptionsListLabels.forbidden)
          : (labels?.failed ?? exceptionsListLabels.failed)}
      </p>
    );
  return <ExceptionsList view={result.data} labels={labels} formatAge={age} />;
}
