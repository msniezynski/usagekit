import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessContext, Meter } from "@usagekit/core";
import type { Problem, ViewState } from "@usagekit/views";
import { useMeterBinding } from "./context.js";

export type HookState = "loading" | ViewState;
export type ViewResult<T> = {
  data: T | null;
  state: HookState;
  error: Problem | null;
  /** Loads again with the same inputs; the previous data stays until the answer arrives. */
  refresh: () => void;
};
export type Binding = { meter?: Meter; access?: AccessContext };
type Loaded = { state: ViewState; problem: Problem | null };

/** JSON with bigint as decimal text, so equal inputs give equal keys across renders. */
export const serialize = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? `${v}n` : v)) ?? "";

/**
 * Shared loader: re-runs when the Meter identity or the serialized access and inputs change,
 * and drops every answer that is not the latest request's.
 */
export function useView<I, T extends Loaded>(
  load: (meter: Meter, access: AccessContext, input: I) => Promise<T>,
  options: Binding & I,
): ViewResult<T> {
  const binding = useMeterBinding();
  const { meter: explicitMeter, access: explicitAccess, ...rest } = options;
  const meter = explicitMeter ?? binding?.meter;
  const access = explicitAccess ?? binding?.access;
  const input = rest as unknown as I;
  const key = serialize([access, input]);
  const [result, setResult] = useState<{ key: string; data: T } | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  useEffect(() => {
    const id = ++latest.current;
    if (!meter || !access) {
      setError({ kind: "error", message: "No Meter: pass meter and access or use MeterProvider" });
      return;
    }
    setError(null);
    load(meter, access, inputRef.current).then(
      (data) => {
        if (id === latest.current) setResult({ key, data });
      },
      (reason: unknown) => {
        if (id === latest.current)
          setError({
            kind: "error",
            message: reason instanceof Error ? reason.message : String(reason),
          });
      },
    );
    return () => {
      if (id === latest.current) latest.current++;
    };
  }, [meter, key, nonce, load]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  if (error) return { data: result?.data ?? null, state: "unavailable", error, refresh };
  if (!result) return { data: null, state: "loading", error: null, refresh };
  return { data: result.data, state: result.data.state, error: result.data.problem, refresh };
}
