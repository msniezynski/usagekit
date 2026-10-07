import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  Problem,
  ViewState,
  ProviderBinding,
  ProviderManagementPort,
  ProviderQuery,
  ProviderSnapshotOf,
} from "@usagekit/views";
import { serialize } from "./keys.js";
import { useProviderManagementBinding } from "./provider-context.js";
import { defaultProviderQueryClient, providerBindingKey } from "./provider-read-client.js";
import type { ProviderQueryClient, ProviderReadSnapshot } from "./provider-read-client.js";

export type ProviderHookBinding = {
  port?: ProviderManagementPort;
  binding?: ProviderBinding;
  client?: ProviderQueryClient;
};
export type ProviderViewResult<K extends ProviderQuery["kind"]> = {
  data: ProviderSnapshotOf<K> | null;
  state: "loading" | ViewState;
  error: Problem | null;
  refreshing: boolean;
  refresh: () => void;
};
const empty: ProviderReadSnapshot = {
  data: null,
  state: "unavailable",
  error: null,
  fetching: false,
};
export function useProviderRead<K extends ProviderQuery["kind"]>(
  query: Extract<ProviderQuery, { kind: K }>,
  options: ProviderHookBinding = {},
): ProviderViewResult<K> {
  const inherited = useProviderManagementBinding();
  const port = options.port ?? inherited?.port,
    binding = options.binding ?? inherited?.binding;
  const client =
    options.client ?? inherited?.client ?? (port ? defaultProviderQueryClient(port) : null);
  const key =
    port && binding ? `${providerBindingKey(port, binding)}:${serialize(query)}` : "missing";
  const entry = useMemo(
    () => (port && binding && client ? client.entry(port, binding, query) : null),
    [client, key],
  );
  const subscribe = useCallback(
    (listener: () => void) => (entry && client ? client.subscribe(entry, listener) : () => {}),
    [entry, client],
  );
  const snapshot = useCallback(() => entry?.snapshot ?? empty, [entry]);
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (entry && client) client.ensure(entry);
  }, [entry, client]);
  const refresh = useCallback(() => {
    if (entry && client) client.refresh(entry);
  }, [entry, client]);
  if (!entry)
    return {
      data: null,
      state: "unavailable",
      error: { kind: "error", message: "No provider management port or verified binding" },
      refreshing: false,
      refresh,
    };
  return {
    data: result.data as ProviderSnapshotOf<K> | null,
    state: result.state,
    error: result.error,
    refreshing: result.fetching && !!result.data,
    refresh,
  };
}
export const useProviderConnections = ({
  provider,
  ...options
}: ProviderHookBinding & { provider?: string } = {}) =>
  useProviderRead<"connections">(
    { kind: "connections", ...(provider !== undefined ? { provider } : {}) },
    options,
  );
export const useProviderConnection = ({
  connectionId,
  ...options
}: ProviderHookBinding & { connectionId: string }) =>
  useProviderRead<"details">({ kind: "details", connectionId }, options);
export const useProviderBalance = ({
  connectionId,
  ...options
}: ProviderHookBinding & { connectionId: string }) =>
  useProviderRead<"balance">({ kind: "balance", connectionId }, options);
export const useProviderProjection = ({
  connectionId,
  operation,
  quantity,
  unit,
  surface,
  ...options
}: ProviderHookBinding & Omit<Extract<ProviderQuery, { kind: "projection" }>, "kind">) =>
  useProviderRead<"projection">(
    { kind: "projection", connectionId, operation, quantity, unit, surface },
    options,
  );
export const useProviderAllocations = ({
  connectionIds,
  ...options
}: ProviderHookBinding & { connectionIds: readonly string[] }) =>
  useProviderRead<"allocations">({ kind: "allocations", connectionIds }, options);
