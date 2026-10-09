"use client";
import { useState } from "react";
import { useProviderAction } from "@usagekit/react";
import type { ProviderAction } from "@usagekit/react";
import type { FundingSource } from "@usagekit/core";
import type { ProviderConnection } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fundingLabel, ProviderActionFeedback } from "@/components/usagekit/provider-feedback";
import { UsageStatus, usageMotion } from "@/components/usagekit/usage-motion";
export const providerSourceLabels = {
  title: "Funding source",
  description: "Provider account charges and host credit charges remain separate.",
  confirm: "Confirm funding change",
  cancel: "Cancel",
  confirmation: "Change the funding source to",
  current: "Current",
};
export type ProviderSourceLabels = typeof providerSourceLabels;
export function ProviderSourceSelector({
  connection,
  action: guardedAction,
  sources,
  description,
  labels: custom,
}: {
  connection: ProviderConnection;
  action?: ProviderAction;
  sources: readonly FundingSource[];
  description?: string;
  labels?: Partial<ProviderSourceLabels>;
}) {
  const labels = { ...providerSourceLabels, ...custom };
  const sharedAction = useProviderAction();
  const action = guardedAction ?? sharedAction;
  const [selected, setSelected] = useState<FundingSource | null>(null);
  const editable =
    action.canWrite &&
    !action.pending &&
    !action.ambiguous &&
    action.state !== "conflict" &&
    connection.capabilities.includes("funding");
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle className="leading-snug">{labels.title}</CardTitle>
        <CardDescription>{description ?? labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="cn-usage-gap-md flex flex-col">
        <p className="cn-usage-body flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{labels.current}</span>
          <UsageStatus key={connection.fundingSource} tone="positive" className={usageMotion.enter}>
            {fundingLabel(connection.fundingSource)}
          </UsageStatus>
        </p>
        <div className="flex flex-wrap gap-2">
          {sources.map((source) => (
            <Button
              key={source}
              type="button"
              variant={
                selected === source
                  ? "secondary"
                  : connection.fundingSource === source
                    ? "secondary"
                    : "outline"
              }
              aria-pressed={connection.fundingSource === source}
              disabled={!editable || source === connection.fundingSource}
              onClick={() => setSelected(source)}
            >
              {fundingLabel(source)}
            </Button>
          ))}
        </div>
        {selected && (
          <div
            key={selected}
            className={`cn-usage-panel flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/50 ${usageMotion.enter}`}
          >
            <p className="cn-usage-title font-medium">
              {labels.confirmation} {fundingLabel(selected)}?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!editable}
                onClick={() => {
                  void action.run({
                    kind: "funding",
                    commandId: crypto.randomUUID(),
                    connectionId: connection.id,
                    expectedRevision: connection.revision,
                    fundingSource: selected,
                  });
                  setSelected(null);
                }}
              >
                {labels.confirm}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)}>
                {labels.cancel}
              </Button>
            </div>
          </div>
        )}
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
