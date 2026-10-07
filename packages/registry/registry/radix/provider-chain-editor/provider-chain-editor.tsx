"use client";
import { useState } from "react";
import { useProviderAction } from "@usagekit/react";
import type { ProviderConnection } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProviderActionFeedback } from "@/components/usagekit/provider-feedback";
export const providerChainLabels = {
  title: "Fallback order",
  description:
    "The host decides when fallback is allowed. This changes the explicit connection order only.",
  up: "Move up",
  down: "Move down",
  add: "Add to fallback",
  remove: "Remove from fallback",
  save: "Save fallback order",
  enable: "Enable",
  disable: "Disable",
  enabled: "Enabled",
  disabled: "Disabled",
  empty: "No fallback connections selected.",
};
export type ProviderChainLabels = typeof providerChainLabels;
export function ProviderChainEditor({
  connection,
  connections,
  labels: custom,
}: {
  connection: ProviderConnection;
  connections: readonly ProviderConnection[];
  labels?: Partial<ProviderChainLabels>;
}) {
  const labels = { ...providerChainLabels, ...custom };
  const action = useProviderAction();
  const [chain, setChain] = useState<readonly string[]>([...connection.fallbackChain]);
  const editable =
    action.canWrite &&
    !action.pending &&
    !action.ambiguous &&
    action.state !== "conflict" &&
    connection.capabilities.includes("settings");
  const submitted = action.submittedCommand;
  const shown =
    (action.pending || action.ambiguous) &&
    submitted?.kind === "settings" &&
    submitted.connectionId === connection.id &&
    submitted.changes.fallbackChain
      ? submitted.changes.fallbackChain
      : chain;
  const move = (index: number, delta: number) => {
    const next = [...chain];
    const other = index + delta;
    [next[index], next[other]] = [next[other]!, next[index]!];
    setChain(next);
  };
  return (
    <Card className="min-w-0 w-full">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {shown.map((id, index) => {
            const item = connections.find((value) => value.id === id);
            return (
              <li key={id} className="rounded-lg border border-border p-3 min-w-0 space-y-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="font-medium break-all">
                    {index + 1}. {item?.label ?? id}
                  </span>
                  <Badge variant="outline">
                    {item?.enabled ? labels.enabled : labels.disabled}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${labels.up}: ${item?.label ?? id}`}
                    disabled={!editable || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    {labels.up}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${labels.down}: ${item?.label ?? id}`}
                    disabled={!editable || index === shown.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    {labels.down}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${labels.remove}: ${item?.label ?? id}`}
                    disabled={!editable}
                    onClick={() => setChain(chain.filter((value) => value !== id))}
                  >
                    {labels.remove}
                  </Button>
                  {item && item.capabilities.includes("settings") && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!editable}
                      onClick={() =>
                        void action.run({
                          kind: "settings",
                          commandId: crypto.randomUUID(),
                          connectionId: item.id,
                          expectedRevision: item.revision,
                          changes: { enabled: !item.enabled },
                        })
                      }
                    >
                      {item.enabled ? labels.disable : labels.enable} {item.label}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {!shown.length && <p className="text-sm text-muted-foreground">{labels.empty}</p>}
        <div className="flex flex-wrap gap-2">
          {connections
            .filter((item) => item.id !== connection.id && !shown.includes(item.id))
            .map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={!editable}
                onClick={() => setChain([...chain, item.id])}
              >
                {labels.add}: {item.label}
              </Button>
            ))}
        </div>
        <Button
          type="button"
          disabled={!editable}
          onClick={() =>
            void action.run({
              kind: "settings",
              commandId: crypto.randomUUID(),
              connectionId: connection.id,
              expectedRevision: connection.revision,
              changes: { fallbackChain: [...chain] },
            })
          }
        >
          {labels.save}
        </Button>
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
