"use client";

import { connectionRows } from "@usagekit/views";
import type { ConnectionInput, ConnectionRow } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const connectionListLabels = {
  title: "Connections",
  label: "Connection",
  provider: "Provider",
  funding: "Funding",
  tags: "Tags",
  plan: "Plan",
  byok: "Own key",
  platform: "Platform",
  noPlan: "No plan",
  empty: "No connections yet.",
};
export type ConnectionListLabels = typeof connectionListLabels;

export type ConnectionListProps = {
  /** Host connection records; rows are normalized with connectionRows. */
  connections: readonly (ConnectionInput | ConnectionRow)[];
  labels?: Partial<ConnectionListLabels>;
};

const head = "h-10 px-4 text-xs font-medium text-muted-foreground";
const cell = "px-4 py-3";
const toRow = (c: ConnectionInput | ConnectionRow): ConnectionRow =>
  "funding" in c ? c : connectionRows([c])[0]!;

/** Connections with label, provider, funding, tags and plan. */
export function ConnectionList({ connections, labels: custom }: ConnectionListProps) {
  const labels = { ...connectionListLabels, ...custom };
  const rows = connections.map(toRow);
  return (
    <div className="rounded-xl border min-w-0 overflow-hidden border-border">
      <Table
        tabIndex={0}
        aria-label={labels.title}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className={head}>{labels.label}</TableHead>
            <TableHead className={head}>{labels.provider}</TableHead>
            <TableHead className={head}>{labels.funding}</TableHead>
            <TableHead className={head}>{labels.tags}</TableHead>
            <TableHead className={head}>{labels.plan}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="text-sm px-4 py-8 text-center text-muted-foreground"
              >
                {labels.empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={`${cell} font-medium`}>{row.label}</TableCell>
                <TableCell className={`${cell} text-muted-foreground`}>{row.provider}</TableCell>
                <TableCell className={cell}>
                  <Badge variant={row.funding === "platform" ? "secondary" : "outline"}>
                    {labels[row.funding]}
                  </Badge>
                </TableCell>
                <TableCell className={cell}>
                  <span className="flex flex-wrap gap-1">
                    {row.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-muted-foreground font-normal"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className={`${cell} ${row.plan ? "" : "text-muted-foreground"}`}>
                  {row.plan ?? labels.noPlan}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
