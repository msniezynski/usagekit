import { useMemo } from "react";
import type { BudgetAlertCrossed, UsageQuery } from "@usagekit/core";
import {
  loadBudgetsView,
  loadCoverageView,
  loadExceptionsView,
  loadHeaderStatus,
  loadUsageView,
  withCrossings,
} from "@usagekit/views";
import type {
  BudgetsInput,
  BudgetsView,
  CoverageInput,
  CoverageView,
  ExceptionsInput,
  ExceptionsView,
  HeaderStatus,
  UsageView,
} from "@usagekit/views";
import { serialize, useView } from "./use-view.js";
import type { Binding, ViewResult } from "./use-view.js";

export const useUsageView = (options: Binding & UsageQuery): ViewResult<UsageView> =>
  useView(loadUsageView, options);
export const useBudgetsView = (options: Binding & BudgetsInput): ViewResult<BudgetsView> =>
  useView(loadBudgetsView, options);
export const useCoverageView = (options: Binding & CoverageInput): ViewResult<CoverageView> =>
  useView(loadCoverageView, options);
export const useExceptionsView = (options: Binding & ExceptionsInput): ViewResult<ExceptionsView> =>
  useView(loadExceptionsView, options);

/**
 * Header status for the visible bounds. crossings from the last command are merged into the
 * loaded status without another read, so a host refreshes the header in the request that settled.
 */
export function useHeaderStatus(
  options: Binding &
    Omit<BudgetsInput, "crossings"> & { crossings?: readonly BudgetAlertCrossed[] },
): ViewResult<HeaderStatus> {
  const { crossings = [], ...rest } = options;
  const result = useView(loadHeaderStatus, rest);
  // Crossings compare by content, so an inline array does not recompute on every render.
  const crossingsKey = serialize(crossings);
  const data = useMemo(
    () => (result.data ? withCrossings(result.data, crossings) : null),
    [result.data, crossingsKey],
  );
  return { ...result, data };
}
