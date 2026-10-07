"use client";
import { useEffect, useState } from "react";
import {
  useProviderConnections,
  useProviderAction,
  useProviderManagementBinding,
} from "@usagekit/react";
import type {
  ProviderConnection,
  ProviderDefinition,
  ProviderManagementPort,
} from "@usagekit/views";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ProviderCard } from "@/components/usagekit/provider-card";
import { ProviderConnectForm } from "@/components/usagekit/provider-connect-form";
import { ProviderSourceSelector } from "@/components/usagekit/provider-source-selector";
import { ProviderRateEditor } from "@/components/usagekit/provider-rate-editor";
import { ProviderChainEditor } from "@/components/usagekit/provider-chain-editor";
import { ProviderBalancePanel } from "@/components/usagekit/provider-balance-card";
import { ProviderAllocationPanel } from "@/components/usagekit/provider-allocation-editor";
import { ProviderReadFeedback } from "@/components/usagekit/provider-feedback";
export const providerManagerLabels = {
  title: "Provider connections",
  connect: "New connection",
  reload: "Reload connections",
  close: "Close editor",
  empty: "No provider connections yet.",
  choose: "Choose a provider",
  manage: "Manage",
};
export type ProviderManagerLabels = typeof providerManagerLabels;
export function ProviderManagerPanel({
  provider: filter,
  oauth,
  labels: custom,
}: {
  provider?: string;
  oauth?: (provider: ProviderDefinition, connection?: ProviderConnection) => ReactNode;
  labels?: Partial<ProviderManagerLabels>;
}) {
  const labels = { ...providerManagerLabels, ...custom };
  const result = useProviderConnections(filter ? { provider: filter } : {});
  const action = useProviderAction();
  const context = useProviderManagementBinding();
  const identity = JSON.stringify(context?.binding);
  const [selected, setSelected] = useState<{
    connection: ProviderConnection;
    identity: string;
    port: ProviderManagementPort | undefined;
  } | null>(null);
  useEffect(() => {
    const answer = action.result;
    if (answer?.outcome === "success" && answer.connection)
      setSelected((prior) =>
        prior?.connection.id === answer.connection!.id &&
        prior.identity === identity &&
        prior.port === context?.port
          ? { ...prior, connection: structuredClone(answer.connection!) }
          : prior,
      );
  }, [action.result, identity, context?.port]);
  const [create, setCreate] = useState<string | null>(null);
  if (
    !result.data ||
    result.state === "loading" ||
    result.state === "forbidden" ||
    result.state === "unavailable"
  )
    return (
      <ProviderReadFeedback state={result.state} error={result.error} refresh={result.refresh} />
    );
  const { connections, providers } = result.data;
  const connection =
    selected?.identity === identity && selected.port === context?.port
      ? selected.connection
      : undefined;
  const definition = providers.find((item) => item.id === (create ?? connection?.provider));
  return (
    <section aria-label={labels.title} className="space-y-6 min-w-0">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h2 className="text-xl font-semibold">{labels.title}</h2>
        <Button
          type="button"
          variant="outline"
          disabled={result.refreshing || action.pending || action.ambiguous}
          onClick={() => {
            setSelected(null);
            setCreate(null);
            action.reset();
            result.refresh();
          }}
        >
          {labels.reload}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {connections.map((item) => (
          <ProviderCard
            key={item.id}
            connection={item}
            onManage={() => {
              setSelected({ connection: structuredClone(item), identity, port: context?.port });
              setCreate(null);
            }}
          />
        ))}
      </div>
      {!connections.length && <p>{labels.empty}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label={labels.choose}>
        {providers
          .filter((item) => item.capabilities.includes("connect"))
          .map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              onClick={() => {
                setCreate(item.id);
                setSelected(null);
              }}
            >
              {labels.connect}: {item.label}
            </Button>
          ))}
      </div>
      {definition && (create || connection) && (
        <section
          key={`${identity}:${create ?? connection?.id}`}
          aria-label={`${labels.manage}: ${connection?.label ?? definition.label}`}
          className="space-y-4 min-w-0"
        >
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSelected(null);
              setCreate(null);
            }}
          >
            {labels.close}
          </Button>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ProviderConnectForm
              key={`${create ?? connection?.id}:${connection?.revision ?? "new"}`}
              provider={definition}
              {...(connection ? { connection } : {})}
              {...(oauth ? { oauth: oauth(definition, connection) } : {})}
              onConnected={(item) => {
                setSelected({ connection: structuredClone(item), identity, port: context?.port });
                setCreate(null);
                action.reset();
                result.refresh();
              }}
            />
            {connection && (
              <>
                <ProviderSourceSelector
                  connection={connection}
                  sources={definition.fundingSources}
                />
                <ProviderBalancePanel connectionId={connection.id} />
                <ProviderRateEditor key={`rates:${connection.revision}`} connection={connection} />
                <ProviderChainEditor
                  key={`chain:${connection.revision}`}
                  connection={connection}
                  connections={connections}
                />
              </>
            )}
          </div>
          {connection && (
            <ProviderAllocationPanel
              connectionIds={[connection.id]}
              fresh={!connection.freshness.stale && !!connection.freshness.observedAt}
            />
          )}
        </section>
      )}
    </section>
  );
}
