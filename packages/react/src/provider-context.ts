import { createContext, createElement, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { ProviderBinding, ProviderManagementPort } from "@usagekit/views";
import { serialize } from "./keys.js";
import { defaultProviderQueryClient, retainProviderBinding } from "./provider-read-client.js";
import type { ProviderQueryClient } from "./provider-read-client.js";

export type ProviderManagementBinding = {
  port: ProviderManagementPort;
  binding: ProviderBinding;
  client?: ProviderQueryClient;
};
export type SharedProviderManagementBinding = ProviderManagementBinding & {
  client: ProviderQueryClient;
};
const Context = createContext<SharedProviderManagementBinding | null>(null);

/** No writer permission is assumed. The host independently authorizes each port call. */
export function ProviderManagementProvider({
  port,
  binding,
  client,
  children,
}: ProviderManagementBinding & { children?: ReactNode }) {
  const retainedBinding = retainProviderBinding(binding);
  const key = serialize(retainedBinding);
  const sharedClient = client ?? defaultProviderQueryClient(port);
  const value = useMemo(
    () => ({ port, binding: retainedBinding, client: sharedClient }),
    [port, key, sharedClient],
  );
  return createElement(Context.Provider, { value }, children);
}
export const useProviderManagementBinding = () => useContext(Context);
