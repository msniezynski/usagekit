import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AccessContext, Meter } from "@usagekit/core";
import type { Problem, ViewState } from "@usagekit/views";
import { useMeterBinding } from "./context.js";
import { createMeterQueryClient, defaultMeterQueryClient, bindingKey } from "./query-client.js";
import type { MeterQueryClient, QuerySnapshot } from "./query-client.js";
import { serialize } from "./keys.js";
export { serialize } from "./keys.js";

export type HookState = "loading" | ViewState;
export type ViewResult<T> = {
  data: T | null;
  state: HookState;
  error: Problem | null;
  refreshing: boolean;
  refresh: () => void;
};
export type Binding = { meter?: Meter; access?: AccessContext; queryClient?: MeterQueryClient };
type Loaded = { state: ViewState; problem: Problem | null };
const empty: QuerySnapshot<never> = { data: null, error: null, fetching: false };

/** Equal reads share an entry; a changed binding or query selects an empty entry immediately. */
export function useView<I, T extends Loaded>(
  load: (meter: Meter, access: AccessContext, input: I) => Promise<T>,
  options: Binding & I,
): ViewResult<T> {
  const binding = useMeterBinding();
  const {
    meter: explicitMeter,
    access: explicitAccess,
    queryClient: explicitClient,
    ...input
  } = options;
  const meter = explicitMeter ?? binding?.meter;
  const access = explicitAccess ?? binding?.access;
  const local = useRef<MeterQueryClient | null>(null);
  if (!local.current) local.current = createMeterQueryClient();
  const client =
    explicitClient ??
    binding?.queryClient ??
    (meter ? defaultMeterQueryClient(meter) : local.current);
  const key = meter && access ? `${bindingKey(meter, access)}:${serialize(input)}` : "missing";
  const entry = useMemo(
    () => (meter && access ? client.entry(meter, access, load, input as I) : null),
    [client, load, key],
  );
  const subscribe = useCallback(
    (listener: () => void) => (entry ? client.subscribe(entry, listener) : () => {}),
    [client, entry],
  );
  const snapshot = useCallback(() => entry?.snapshot ?? empty, [entry]);
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (entry) client.ensure(entry);
  }, [client, entry]);
  const refresh = useCallback(() => {
    if (entry) client.refresh(entry);
  }, [client, entry]);
  if (!meter || !access)
    return {
      data: null,
      state: "unavailable",
      error: { kind: "error", message: "No Meter: pass meter and access or use MeterProvider" },
      refreshing: false,
      refresh,
    };
  if (result.error)
    return { data: null, state: "unavailable", error: result.error, refreshing: false, refresh };
  const data = result.data;
  return {
    data,
    state: data?.state ?? "loading",
    error: data?.problem ?? null,
    refreshing: result.fetching && !!data,
    refresh,
  };
}
