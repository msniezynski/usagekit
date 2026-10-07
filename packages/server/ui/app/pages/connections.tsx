import { useEffect, useState } from "react";
import { useProviderAction, useProviderConnections } from "@usagekit/react";
import type { ProviderConnection, ConnectionInput } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { ConnectionList } from "@/components/usagekit/connection-list";
import { ProviderCard } from "@/components/usagekit/provider-card";
import { ProviderConnectForm } from "@/components/usagekit/provider-connect-form";
import { ProviderRateEditor } from "@/components/usagekit/provider-rate-editor";
import { ProviderReadFeedback } from "@/components/usagekit/provider-feedback";

const formatOnly = {
  test: "Check credential format",
  testHint:
    "Checks credential format locally. It does not contact the provider, validate the key remotely or create provider charges.",
};

/** Local host capabilities decide which shared controls are present. */
export function ConnectionsPage({ connections }: { connections: readonly ConnectionInput[] }) {
  const result = useProviderConnections();
  const action = useProviderAction();
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  useEffect(() => {
    const answer = action.result;
    if (answer?.outcome === "success" && answer.connection)
      setEditing((prior) =>
        prior?.id === answer.connection!.id ? structuredClone(answer.connection!) : prior,
      );
  }, [action.result]);
  const provider = result.data?.providers.find(
    (item) => item.id === (creating ?? editing?.provider),
  );
  const reload = () => {
    action.reset();
    setEditing(null);
    setCreating(null);
    result.refresh();
  };
  return (
    <section aria-label="Connections" className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Provider connections</h1>
        <Button
          type="button"
          variant="outline"
          disabled={action.pending || action.ambiguous || result.refreshing}
          onClick={reload}
        >
          Reload connections
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        The local server uses your own provider keys. Credential checks validate format only; they
        never send a provider request.
      </p>
      {result.data && (result.state === "ok" || result.state === "empty") ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {result.data.connections.map((item) => (
              <ProviderCard
                key={item.id}
                connection={item}
                labels={{ test: "Check stored credential format" }}
                onManage={() => {
                  if (editing?.id !== item.id) setEditing(structuredClone(item));
                  setCreating(null);
                }}
              />
            ))}
          </div>
          {!result.data.connections.length && <p>No provider connections yet.</p>}
          <div className="flex flex-wrap gap-2">
            {result.data.providers
              .filter((item) => item.capabilities.includes("connect"))
              .map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCreating(item.id);
                    setEditing(null);
                  }}
                >
                  Connect {item.label}
                </Button>
              ))}
          </div>
          {provider && (creating || editing) && (
            <section aria-label="Connection editor" className="space-y-4 min-w-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setCreating(null);
                }}
              >
                Close editor
              </Button>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ProviderConnectForm
                  key={`${creating ?? editing?.id}:${editing?.revision ?? "new"}`}
                  provider={provider}
                  {...(editing ? { connection: editing } : {})}
                  labels={formatOnly}
                  onConnected={(item) => {
                    setEditing(item);
                    setCreating(null);
                    result.refresh();
                  }}
                />
                {editing && !!editing.rates.length && (
                  <ProviderRateEditor key={`rates:${editing.revision}`} connection={editing} />
                )}
              </div>
            </section>
          )}
        </>
      ) : (
        <ProviderReadFeedback state={result.state} error={result.error} refresh={result.refresh} />
      )}
      {!!connections.length && (
        <section aria-label="Connection history" className="space-y-3">
          <h2 className="text-lg font-semibold">Connection history</h2>
          <ConnectionList connections={connections} />
        </section>
      )}
    </section>
  );
}
