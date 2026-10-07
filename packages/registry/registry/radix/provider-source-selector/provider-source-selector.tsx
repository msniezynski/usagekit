"use client";
import { useState } from "react";
import { useProviderAction } from "@usagekit/react";
import type { FundingSource } from "@usagekit/core";
import type { ProviderConnection } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fundingLabel, ProviderActionFeedback } from "@/components/usagekit/provider-feedback";
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
  sources,
  description,
  labels: custom,
}: {
  connection: ProviderConnection;
  sources: readonly FundingSource[];
  description?: string;
  labels?: Partial<ProviderSourceLabels>;
}) {
  const labels = { ...providerSourceLabels, ...custom };
  const action = useProviderAction();
  const [selected, setSelected] = useState<FundingSource | null>(null);
  const editable =
    action.canWrite &&
    !action.pending &&
    !action.ambiguous &&
    action.state !== "conflict" &&
    connection.capabilities.includes("funding");
  return (
    <Card className="min-w-0 w-full">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{description ?? labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          {labels.current}: {fundingLabel(connection.fundingSource)}
        </p>
        <div className="flex flex-wrap gap-2">
          {sources.map((source) => (
            <Button
              key={source}
              type="button"
              variant={connection.fundingSource === source ? "secondary" : "outline"}
              aria-pressed={connection.fundingSource === source}
              disabled={!editable || source === connection.fundingSource}
              onClick={() => setSelected(source)}
            >
              {fundingLabel(source)}
            </Button>
          ))}
        </div>
        {selected && (
          <div className="space-y-2">
            <p>
              {labels.confirmation} {fundingLabel(selected)}?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
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
              <Button type="button" variant="outline" onClick={() => setSelected(null)}>
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
