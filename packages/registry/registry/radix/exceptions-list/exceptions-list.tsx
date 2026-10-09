"use client";

import { useExceptionsView } from "@usagekit/react";
import type { ExceptionKind, ExceptionsInput, ExceptionsView } from "@usagekit/views";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UsageStatus, usageMotion } from "@/components/usagekit/usage-motion";
import type { UsageTone } from "@/components/usagekit/usage-motion";

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

const kindTone: Record<ExceptionKind, UsageTone> = {
  lease_expired: "exceeded",
  reservation_expired: "warning",
  pending: "neutral",
};
const head = "cn-usage-head font-medium text-muted-foreground";
const cell = "cn-usage-cell";

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
  if (!view)
    return (
      <div role="status" className="cn-usage-frame cn-usage-cell min-w-0 border-border">
        <span className="sr-only">{labels.loading}</span>
        <span
          aria-hidden
          className="block h-4 w-full max-w-sm cn-usage-skeleton animate-pulse motion-reduce:animate-none"
        />
      </div>
    );
  if (view.state === "forbidden" || view.state === "unavailable")
    return (
      <p
        role="status"
        className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {view.state === "forbidden" ? labels.forbidden : labels.failed}
      </p>
    );
  return (
    <div className="cn-usage-frame min-w-0 overflow-hidden border-border">
      <Table
        tabIndex={0}
        aria-label={labels.title}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className={head}>{labels.operation}</TableHead>
            <TableHead className={head}>{labels.provider}</TableHead>
            <TableHead className={head}>{labels.principal}</TableHead>
            <TableHead className={head}>{labels.kind}</TableHead>
            <TableHead className={head}>{labels.state}</TableHead>
            <TableHead className={`${head} text-right`}>{labels.age}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={6}
                className="cn-usage-body px-4 py-8 text-center text-muted-foreground"
              >
                {labels.empty}
              </TableCell>
            </TableRow>
          ) : (
            view.rows.map((row) => (
              <TableRow
                key={row.operationId}
                data-kind={row.kind}
                className="transition-[background-color,opacity] duration-300 starting:opacity-0 motion-reduce:transition-none"
              >
                <TableCell className={`${cell} font-mono text-xs text-muted-foreground`}>
                  {row.operationId}
                </TableCell>
                <TableCell className={cell}>
                  <span className="font-medium">{row.provider}</span>{" "}
                  <span className="text-muted-foreground">{row.operation}</span>
                </TableCell>
                <TableCell className={cell}>{row.principal}</TableCell>
                <TableCell className={cell}>
                  <UsageStatus tone={kindTone[row.kind]}>
                    {labels[row.kind as ExceptionKind]}
                  </UsageStatus>
                </TableCell>
                <TableCell className={`${cell} text-muted-foreground`}>{row.state}</TableCell>
                <TableCell className={`${cell} text-right tabular-nums`}>
                  {age(row.ageSeconds)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
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
      <p
        role="alert"
        className={`cn-usage-empty cn-usage-body border-border text-muted-foreground ${usageMotion.enter}`}
      >
        {result.state === "forbidden"
          ? (labels?.forbidden ?? exceptionsListLabels.forbidden)
          : (labels?.failed ?? exceptionsListLabels.failed)}
      </p>
    );
  return <ExceptionsList view={result.data} labels={labels} formatAge={age} />;
}
