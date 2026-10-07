"use client";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useProviderAction, useProviderManagementBinding } from "@usagekit/react";
import type { ProviderConnection, ProviderDefinition, ProviderCommand } from "@usagekit/views";
import type { FundingSource } from "@usagekit/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fundingLabel, ProviderActionFeedback } from "@/components/usagekit/provider-feedback";
export const providerConnectLabels = {
  connect: "Connect",
  reconnect: "Replace credentials",
  test: "Test credentials",
  disconnect: "Disconnect",
  confirmDisconnect: "Confirm disconnect",
  cancel: "Cancel",
  disconnectHint: "Disconnect this connection?",
  title: "Connection credentials",
  secretHint: "Enter new credentials. Stored credentials are never displayed.",
  testHint: "Testing makes an explicit request to the provider. Saving is a separate action.",
  label: "Connection name",
  required: "Enter the required credentials.",
  funding: "Funding source",
};
export type ProviderConnectLabels = typeof providerConnectLabels;
type ConnectProps = {
  provider: ProviderDefinition;
  connection?: ProviderConnection;
  fundingSource?: FundingSource;
  oauth?: ReactNode;
  onConnected?: (connection: ProviderConnection) => void;
  labels?: Partial<ProviderConnectLabels>;
};
export function ProviderConnectForm(props: ConnectProps) {
  const context = useProviderManagementBinding();
  const identity = JSON.stringify([
    context?.binding,
    props.provider.id,
    props.connection?.id,
    props.connection?.fundingSource,
    props.fundingSource,
  ]);
  const retained = useRef({ port: context?.port, identity, epoch: 0 });
  if (retained.current.port !== context?.port || retained.current.identity !== identity)
    retained.current = { port: context?.port, identity, epoch: retained.current.epoch + 1 };
  return <CredentialForm key={retained.current.epoch} {...props} />;
}
function CredentialForm({
  provider,
  connection,
  fundingSource = "byok",
  oauth,
  onConnected,
  labels: custom,
}: {
  provider: ProviderDefinition;
  connection?: ProviderConnection;
  fundingSource?: FundingSource;
  oauth?: ReactNode;
  onConnected?: (connection: ProviderConnection) => void;
  labels?: Partial<ProviderConnectLabels>;
}) {
  const labels = { ...providerConnectLabels, ...custom };
  const action = useProviderAction();
  const id = useId();
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [label, setLabel] = useState(connection?.label ?? provider.label);
  const [source, setSource] = useState(connection?.fundingSource ?? fundingSource);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const editable =
    action.canWrite && !action.pending && !action.ambiguous && action.state !== "conflict";
  const capabilities = connection?.capabilities ?? provider.capabilities;
  const fields = provider.credentialFields.filter((field) =>
    (field.fundingSources ?? ["byok"]).includes(source),
  );
  const submit = async (kind: "test" | "connect" | "reconnect") => {
    if (!editable) return;
    if (fields.some((field) => field.required && !secrets[field.name]?.trim())) {
      setError(labels.required);
      return;
    }
    setError(null);
    // Credential values are an ephemeral execute argument, never part of the command or read cache.
    const ephemeral = { ...secrets };
    const commandId = crypto.randomUUID();
    const command: ProviderCommand = connection
      ? kind === "test"
        ? {
            kind: "test",
            commandId,
            connectionId: connection.id,
            expectedRevision: connection.revision,
          }
        : {
            kind: "reconnect",
            commandId,
            connectionId: connection.id,
            expectedRevision: connection.revision,
          }
      : kind === "test"
        ? { kind: "test", commandId, provider: provider.id, fundingSource: source }
        : { kind: "connect", commandId, provider: provider.id, fundingSource: source, label };
    const result = await action.run(command, ephemeral);
    for (const name of Object.keys(ephemeral)) delete ephemeral[name];
    if (kind !== "test" || result.outcome !== "success") setSecrets({});
    if (result?.outcome === "success" && result.connection) onConnected?.(result.connection);
  };
  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>
          {provider.label} · {labels.secretHint}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          aria-label={`${provider.label} credentials`}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(connection ? "reconnect" : "connect");
          }}
        >
          {!connection && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${id}-label`}>{labels.label}</Label>
                <Input
                  id={`${id}-label`}
                  value={label}
                  readOnly={!editable}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">{labels.funding}</legend>
                <div className="flex flex-wrap gap-2">
                  {provider.fundingSources.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={source === value ? "secondary" : "outline"}
                      disabled={!editable}
                      aria-pressed={source === value}
                      onClick={() => {
                        setSource(value);
                        setSecrets({});
                      }}
                    >
                      {fundingLabel(value)}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          {fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
              <Input
                id={`${id}-${field.name}`}
                type={field.kind === "secret" ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={secrets[field.name] ?? ""}
                readOnly={!editable}
                placeholder={field.placeholder}
                onChange={(event) => setSecrets({ ...secrets, [field.name]: event.target.value })}
              />
            </div>
          ))}
          {oauth}
          <p className="text-xs text-muted-foreground">{labels.testHint}</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {capabilities.includes("test") && (
              <Button
                type="button"
                variant="outline"
                disabled={!editable}
                onClick={() => void submit("test")}
              >
                {labels.test}
              </Button>
            )}
            {capabilities.includes(connection ? "reconnect" : "connect") && (
              <Button type="submit" disabled={!editable}>
                {connection ? labels.reconnect : labels.connect}
              </Button>
            )}
          </div>
        </form>
        {connection && capabilities.includes("disconnect") && (
          <div className="space-y-2">
            {confirm ? (
              <>
                <p>{labels.disconnectHint}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={!editable}
                    onClick={() => {
                      setConfirm(false);
                      setSecrets({});
                      void action.run({
                        kind: "disconnect",
                        commandId: crypto.randomUUID(),
                        connectionId: connection.id,
                        expectedRevision: connection.revision,
                      });
                    }}
                  >
                    {labels.confirmDisconnect}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setConfirm(false)}>
                    {labels.cancel}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={!editable}
                onClick={() => setConfirm(true)}
              >
                {labels.disconnect}
              </Button>
            )}
          </div>
        )}
        <ProviderActionFeedback action={action} />
      </CardContent>
    </Card>
  );
}
