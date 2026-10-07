import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  ProviderActionResult,
  ProviderBinding,
  ProviderCommand,
  ProviderReconciliation,
} from "@usagekit/views";
import { identity, retainReadInput, serialize } from "./keys.js";
import { useCallbackFence } from "./callback-fence.js";
import { useProviderManagementBinding } from "./provider-context.js";
import {
  defaultProviderQueryClient,
  providerBindingKey,
  retainProviderBinding,
} from "./provider-read-client.js";
import { copyEphemeralSecrets, retainProviderCommand } from "./provider-command.js";
import { retainProviderReply, forgetEphemeralSecrets } from "./provider-secret-guard.js";
import {
  idleProviderAction,
  providerActionEntry,
  publishProviderAction,
  trimProviderActions,
} from "./provider-action-state.js";
import type { ProviderActionState } from "./provider-action-state.js";
import type { ProviderHookBinding } from "./provider-hooks.js";

export type ProviderAction = {
  state: ProviderActionState;
  result: ProviderActionResult | null;
  pending: boolean;
  ambiguous: boolean;
  canWrite: boolean;
  /** Status reads remain server-authorized when management access is withdrawn. */
  canReconcile: boolean;
  submittedCommand: ProviderCommand | null;
  run(
    command: ProviderCommand,
    secrets?: Readonly<Record<string, string>>,
  ): Promise<ProviderActionResult>;
  reconcile(): Promise<ProviderReconciliation>;
  reset(): void;
};
export type ProviderActionOptions = ProviderHookBinding;
const forbidden = (commandId: string): ProviderActionResult => ({
  outcome: "forbidden",
  commandId,
});
const unavailable = (commandId: string, message: string): ProviderActionResult => ({
  outcome: "unavailable",
  commandId,
  message,
  ambiguous: true,
});

/** One manual command per host scope. Unknown work keeps its original ID/body, never its credentials. */
export function useProviderAction(options: ProviderHookBinding = {}): ProviderAction {
  const inherited = useProviderManagementBinding();
  const port = options.port ?? inherited?.port;
  const suppliedBinding = options.binding ?? inherited?.binding;
  const binding = suppliedBinding ? retainProviderBinding(suppliedBinding) : undefined;
  const client =
    options.client ?? inherited?.client ?? (port ? defaultProviderQueryClient(port) : null);
  const ownerKey = port && binding ? providerBindingKey(port, binding) : "missing";
  // Auth revision changes cannot release an earlier ambiguous command in this same host scope.
  const gateKey = port && binding ? serialize([binding.scopeKey, binding.principalKey]) : "missing";
  const isCurrent = useCallbackFence(`${client ? identity(client) : "missing"}:${ownerKey}`);
  const entry = useMemo(
    () => (gateKey !== "missing" ? providerActionEntry(gateKey) : null),
    [gateKey],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!entry) return () => {};
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        trimProviderActions();
      };
    },
    [entry],
  );
  const snapshot = useCallback(() => entry?.snapshot ?? idleProviderAction, [entry]);
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  const canWrite = !!port && !!binding && binding.canManage === true;
  const allowed = () => isCurrent() && canWrite;
  const mayReadStatus = () => isCurrent() && !!port && !!binding;
  const finish = (answer: ProviderActionResult, resolving = false) => {
    if (!entry) return;
    const ambiguous = resolving
      ? answer.outcome !== "success" && answer.outcome !== "conflict"
      : answer.outcome === "unavailable" && answer.ambiguous;
    publishProviderAction(entry, {
      state: answer.outcome,
      result: answer,
      pending: false,
      ambiguous,
    });
    if (
      port &&
      binding &&
      client &&
      (answer.outcome === "success" || answer.outcome === "conflict")
    )
      client.invalidate(port, binding);
  };
  const run = async (
    command: ProviderCommand,
    secrets?: Readonly<Record<string, string>>,
  ): Promise<ProviderActionResult> => {
    const rawId =
      command && typeof command === "object"
        ? Object.getOwnPropertyDescriptor(command, "commandId")?.value
        : undefined;
    const commandId = typeof rawId === "string" ? rawId : "";
    if (!allowed() || !entry || !port || !binding) return forbidden(commandId);
    if (entry.snapshot.pending || entry.snapshot.ambiguous)
      return unavailable(
        commandId,
        "Reconcile the previous provider command before submitting again",
      );
    const validation = retainProviderCommand(command);
    if (!("command" in validation)) return { outcome: "invalid", commandId, ...validation };
    const retained = validation.command;
    if (entry.command?.commandId === commandId) {
      if (serialize(entry.command) !== serialize(retained))
        return {
          outcome: "invalid",
          commandId,
          field: "commandId",
          reason: "Command ID already identifies another body",
        };
      if (secrets !== undefined)
        return {
          outcome: "invalid",
          commandId,
          field: "commandId",
          reason: "Credential commands require a fresh command ID",
        };
      if (entry.snapshot.result) {
        if (entry.ownerKey !== ownerKey) {
          const answer = unavailable(
            commandId,
            "Reconcile the original command under the current binding",
          );
          finish(answer);
          return answer;
        }
        return entry.snapshot.result;
      }
    }
    let ephemeral: Record<string, string> | undefined;
    try {
      ephemeral = copyEphemeralSecrets(secrets);
    } catch {
      return {
        outcome: "invalid",
        commandId,
        field: "credentials",
        reason: "Invalid credential fields",
      };
    }
    secrets = undefined;
    entry.command = retained;
    entry.binding = binding;
    entry.ownerKey = ownerKey;
    entry.credentialBearing =
      (!!ephemeral && Object.keys(ephemeral).length > 0) ||
      ["connect", "test", "reconnect"].includes(retained.kind);
    publishProviderAction(entry, {
      state: "pending",
      result: null,
      pending: true,
      ambiguous: false,
    });
    let answer: ProviderActionResult;
    try {
      answer = await port.execute(binding, retained, ephemeral);
      if (answer.commandId !== commandId)
        answer = unavailable(commandId, "The host response does not match the original command");
      else answer = retainProviderReply(answer, entry.credentialBearing);
    } catch {
      answer = unavailable(commandId, "The provider command could not be confirmed");
    } finally {
      forgetEphemeralSecrets(ephemeral);
    }
    finish(
      allowed()
        ? answer
        : unavailable(commandId, "The provider binding changed; reconcile the original command"),
    );
    return allowed() ? answer : forbidden(commandId);
  };
  const reconcile = async (): Promise<ProviderReconciliation> => {
    const commandId = entry?.command?.commandId ?? "";
    if (!mayReadStatus() || !entry || !port || !binding) return forbidden(commandId);
    if (entry.snapshot.pending)
      return unavailable(commandId, "The original provider command is still pending");
    if (!entry.snapshot.ambiguous || !entry.command)
      return entry.snapshot.result ?? { outcome: "not_applied", commandId };
    if (!port.reconcile)
      return unavailable(
        commandId,
        "The host cannot reconcile this command; a read alone does not prove it was not applied",
      );
    publishProviderAction(entry, { ...entry.snapshot, state: "pending", pending: true });
    let answer: ProviderReconciliation;
    try {
      answer = await port.reconcile(binding, entry.command);
      if (answer.commandId !== commandId)
        answer = unavailable(
          commandId,
          "The host reconciliation does not match the original command",
        );
      else
        answer =
          answer.outcome === "not_applied"
            ? retainReadInput(answer)
            : retainProviderReply(answer, entry.credentialBearing);
    } catch {
      answer = unavailable(commandId, "The provider command could not be reconciled");
    }
    if (!mayReadStatus()) {
      finish(
        unavailable(commandId, "The provider binding changed; reconcile the original command"),
        true,
      );
      return forbidden(commandId);
    }
    entry.ownerKey = ownerKey;
    entry.binding = binding;
    if (answer.outcome === "not_applied") {
      entry.command = null;
      publishProviderAction(entry, idleProviderAction);
    } else finish(answer, true);
    return answer;
  };
  const reset = () => {
    if (!isCurrent() || !entry || entry.snapshot.pending || entry.snapshot.ambiguous) return;
    entry.command = null;
    entry.binding = null;
    entry.ownerKey = null;
    entry.credentialBearing = false;
    publishProviderAction(entry, idleProviderAction);
  };
  const visible = !entry?.ownerKey || entry.ownerKey === ownerKey;
  return {
    state: visible ? result.state : result.pending || result.ambiguous ? "unavailable" : "idle",
    result: visible ? result.result : null,
    pending: result.pending,
    ambiguous: result.ambiguous,
    canWrite,
    canReconcile: !!port?.reconcile && !!binding,
    submittedCommand: visible ? (entry?.command ?? null) : null,
    run,
    reconcile,
    reset,
  };
}
