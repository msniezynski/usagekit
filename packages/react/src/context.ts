import { createContext, createElement, useContext, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import type { AccessContext, Meter } from "@usagekit/core";
import { createMeterQueryClient } from "./query-client.js";
import type { MeterQueryClient } from "./query-client.js";
import type { BudgetWriter } from "./writer.js";
import { retainReadInput, serialize } from "./keys.js";

export type MeterBinding = {
  meter: Meter;
  access: AccessContext;
  queryClient?: MeterQueryClient;
  budgetWriter?: BudgetWriter;
};
export type SharedMeterBinding = MeterBinding & { queryClient: MeterQueryClient };
const MeterContext = createContext<SharedMeterBinding | null>(null);

/** Pages pass the Meter and the verified AccessContext once; hooks read them from here. */
export function MeterProvider({
  meter,
  access,
  queryClient,
  budgetWriter,
  children,
}: MeterBinding & { children?: ReactNode }) {
  const local = useRef<MeterQueryClient | null>(null);
  if (!local.current) local.current = createMeterQueryClient();
  const client = queryClient ?? local.current;
  const accessKey = serialize(access);
  const value = useMemo(
    () => ({
      meter,
      access: retainReadInput(access),
      queryClient: client,
      ...(budgetWriter ? { budgetWriter } : {}),
    }),
    [meter, accessKey, client, budgetWriter],
  );
  return createElement(MeterContext.Provider, { value }, children);
}
export const useMeterBinding = (): SharedMeterBinding | null => useContext(MeterContext);
