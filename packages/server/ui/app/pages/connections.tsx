import { useState } from "react";
import { useProviderEditor } from "@usagekit/react";
import type { ProviderConnection, ProviderDefinition, ConnectionInput } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { ConnectionList } from "@/components/usagekit/connection-list";
import { ProviderCard } from "@/components/usagekit/provider-card";
import { ProviderConnectForm } from "@/components/usagekit/provider-connect-form";
import { ProviderRateEditor } from "@/components/usagekit/provider-rate-editor";
import { ProviderReadFeedback } from "@/components/usagekit/provider-feedback";
import { UsageSpinner, usageMotion } from "@/components/usagekit/usage-motion";

const formatOnly = {
  test: "Check credential format",
  testHint:
    "Checks credential format locally. It does not contact the provider, validate the key remotely or create provider charges.",
};

/** Local host capabilities decide which shared controls are present. */
export function ConnectionsPage({ connections }: { connections: readonly ConnectionInput[] }) {
  const result = useProviderEditor({ kind: "connections" });
  const action = { ...result.action, canWrite: result.canEdit };
  const [selected, setSelected] = useState<{
    connection: ProviderConnection;
    definition: ProviderDefinition;
    epoch: string;
  } | null>(null);
  const [create, setCreate] = useState<{ definition: ProviderDefinition; epoch: string } | null>(
    null,
  );
  const editing = selected?.epoch === result.editorEpoch ? selected.connection : null;
  const creation = create?.epoch === result.editorEpoch ? create.definition : null;
  const creating = creation?.id ?? null;
  const current = result.evidence?.connections.find((item) => item.id === editing?.id) ?? null;
  const provider =
    result.evidence?.providers.find((item) => item.id === (creating ?? editing?.provider)) ??
    (editing ? selected?.definition : creation);
  const reloadDisabled = action.pending || action.ambiguous || result.refreshing;
  return (
    <section aria-label="Connections" className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Provider connections</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            The local server uses your own provider keys. Credential checks validate format only;
            they never send a provider request.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reloadDisabled}
          onClick={result.reload}
        >
          {result.refreshing && <UsageSpinner />}
          Reload connections
        </Button>
      </div>
      {!result.evidence && (
        <ProviderReadFeedback
          state={result.state}
          error={result.error}
          refresh={result.reload}
          disabled={reloadDisabled}
        />
      )}
      {result.editorData && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {result.evidence?.connections.map((item) => (
              <ProviderCard
                key={item.id}
                connection={item}
                action={action}
                selected={editing?.id === item.id}
                labels={{ test: "Check stored credential format" }}
                onManage={() => {
                  const definition = result.evidence?.providers.find(
                    (value) => value.id === item.provider,
                  );
                  if (!definition) return;
                  if (editing?.id !== item.id)
                    setSelected({
                      connection: structuredClone(item),
                      definition: structuredClone(definition),
                      epoch: result.editorEpoch,
                    });
                  setCreate(null);
                }}
              />
            ))}
          </div>
          {result.evidence && !result.evidence.connections.length && (
            <p className="rounded-lg border border-dashed border-border px-4 py-3.5 text-sm text-muted-foreground">
              No provider connections yet.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {result.evidence?.providers
              .filter((item) => item.capabilities.includes("connect"))
              .map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  variant="outline"
                  disabled={!result.canEdit}
                  onClick={() => {
                    setCreate({ definition: structuredClone(item), epoch: result.editorEpoch });
                    setSelected(null);
                  }}
                >
                  Connect {item.label}
                </Button>
              ))}
          </div>
          {provider && (creating || editing) && (
            <section
              key={`${result.editorEpoch}:${creating ?? editing?.id}`}
              aria-label="Connection editor"
              className={`min-w-0 space-y-4 rounded-xl border border-border bg-muted/30 p-4 sm:p-5 ${usageMotion.enter}`}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelected(null);
                  setCreate(null);
                }}
              >
                Close editor
              </Button>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {result.evidence && (!editing || current) && (
                  <ProviderConnectForm
                    key={`${creating ?? editing?.id}:${editing?.revision ?? "new"}`}
                    provider={provider}
                    action={action}
                    {...(current ? { connection: current } : {})}
                    labels={formatOnly}
                    onConnected={(item) => {
                      setSelected((prior) =>
                        prior?.epoch === result.editorEpoch && prior.connection.id === item.id
                          ? prior
                          : {
                              connection: structuredClone(item),
                              definition: structuredClone(provider),
                              epoch: result.editorEpoch,
                            },
                      );
                      setCreate(null);
                    }}
                  />
                )}
                {editing && !!editing.rates.length && (
                  <ProviderRateEditor
                    connection={editing}
                    evidence={current}
                    action={{ ...action, canWrite: action.canWrite && !!current }}
                  />
                )}
              </div>
            </section>
          )}
        </>
      )}
      {!!connections.length && (
        <section aria-label="Connection history" className="space-y-3">
          <h2 className="text-base font-semibold">Connection history</h2>
          <ConnectionList connections={connections} />
        </section>
      )}
    </section>
  );
}
