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

const toRow = (c: ConnectionInput | ConnectionRow): ConnectionRow =>
  "funding" in c ? c : connectionRows([c])[0]!;

/** Connections with label, provider, funding badge, tags and plan. */
export function ConnectionList({ connections, labels: custom }: ConnectionListProps) {
  const labels = { ...connectionListLabels, ...custom };
  const rows = connections.map(toRow);
  return (
    <Table
      tabIndex={0}
      aria-label={labels.title}
      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
    >
      <TableHeader>
        <TableRow>
          <TableHead>{labels.label}</TableHead>
          <TableHead>{labels.provider}</TableHead>
          <TableHead>{labels.funding}</TableHead>
          <TableHead>{labels.tags}</TableHead>
          <TableHead>{labels.plan}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              {labels.empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell>{row.provider}</TableCell>
              <TableCell>
                <Badge variant={row.funding === "platform" ? "secondary" : "outline"}>
                  {labels[row.funding]}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {row.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-muted-foreground">
                      {tag}
                    </Badge>
                  ))}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">{row.plan ?? labels.noPlan}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
