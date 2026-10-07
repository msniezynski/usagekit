"use client";
import { useProviderAction } from "@usagekit/react";
import type { ProviderConnection } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fundingLabel, ProviderActionFeedback } from "@/components/usagekit/provider-feedback";
export const providerCardLabels = {
  enabled: "Enabled",
  disabled: "Disabled",
  enable: "Enable connection",
  disable: "Disable connection",
  manage: "Manage connection",
  test: "Test stored credentials",
  disconnect: "Disconnect",
  confirm: "Confirm disconnect",
  cancel: "Cancel",
  disconnectHint: "Disconnect this connection?",
  credential: "Credentials",
  stored: "Stored securely",
  missing: "Not configured",
  stale: "Stale evidence",
  observed: "Last observed",
  unknown: "Unknown",
  available: "Available",
  unavailable: "Unavailable",
};
export type ProviderCardLabels = typeof providerCardLabels;
export function ProviderCard({
  connection,
  onManage,
  labels: custom,
}: {
  connection: ProviderConnection;
  onManage?: () => void;
  labels?: Partial<ProviderCardLabels>;
}) {
  const labels = { ...providerCardLabels, ...custom };
  const action = useProviderAction();
  const writable = action.canWrite && !action.pending && !action.ambiguous;
  const command = { connectionId: connection.id, expectedRevision: connection.revision };
  const test = () => action.run({ ...command, commandId: crypto.randomUUID(), kind: "test" });
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="break-words">{connection.label}</CardTitle>
          <Badge variant="outline">{fundingLabel(connection.fundingSource)}</Badge>
        </div>
        <CardDescription>
          {connection.provider}
          {connection.plan ? ` · ${connection.plan}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={connection.status.state === "connected" ? "secondary" : "outline"}>
            {connection.status.state.replaceAll("_", " ")}
          </Badge>
          <Badge variant="outline">{connection.enabled ? labels.enabled : labels.disabled}</Badge>
          <Badge variant="outline">{labels[connection.availability.state]}</Badge>
        </div>
        {connection.status.message && (
          <p className="text-sm break-words">{connection.status.message}</p>
        )}
        {connection.availability.reason && (
          <p className="text-sm text-muted-foreground break-words">
            {connection.availability.reason}
          </p>
        )}
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{labels.credential}</dt>
            <dd>
              {connection.credentialLabel ??
                (connection.hasStoredCredentials ? labels.stored : labels.missing)}
              {connection.credentialIssue ? ` · ${connection.credentialIssue}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{labels.observed}</dt>
            <dd className="break-all">
              {connection.freshness.observedAt ?? labels.unknown}
              {connection.freshness.stale ? ` · ${labels.stale}` : ""}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {onManage && (
            <Button type="button" variant="outline" onClick={onManage}>
              {labels.manage}
            </Button>
          )}
          {connection.capabilities.includes("settings") && (
            <Button
              type="button"
              variant="outline"
              disabled={!writable}
              onClick={() =>
                void action.run({
                  kind: "settings",
                  ...command,
                  commandId: crypto.randomUUID(),
                  changes: { enabled: !connection.enabled },
                })
              }
            >
              {connection.enabled ? labels.disable : labels.enable}
            </Button>
          )}
          {connection.capabilities.includes("test") && (
            <Button
              type="button"
              variant="outline"
              disabled={!writable || !connection.hasStoredCredentials}
              onClick={() => void test()}
            >
              {labels.test}
            </Button>
          )}
        </div>
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
