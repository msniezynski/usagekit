import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { AccessContext, Meter } from "@usagekit/core";

export type MeterBinding = { meter: Meter; access: AccessContext };
const MeterContext = createContext<MeterBinding | null>(null);

/** Pages pass the Meter and the verified AccessContext once; hooks read them from here. */
export function MeterProvider({
  meter,
  access,
  children,
}: MeterBinding & { children?: ReactNode }) {
  return createElement(MeterContext.Provider, { value: { meter, access } }, children);
}
export const useMeterBinding = (): MeterBinding | null => useContext(MeterContext);
