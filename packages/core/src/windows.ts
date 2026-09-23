import type { BudgetWindow } from "./contracts.js";
export type ResolvedWindow = { epoch: string; startsAt: string; endsAt: string | null };
export function resolveWindow(window: BudgetWindow, now: Date): ResolvedWindow {
  if (!Number.isFinite(now.getTime())) throw new Error("InvalidInput: now");
  if (window.kind === "rolling") throw new Error("UnsupportedWindow: rollingWindows");
  if (window.kind === "calendar_month") {
    const year = now.getUTCFullYear(),
      month = now.getUTCMonth();
    return {
      epoch: now.toISOString().slice(0, 7),
      startsAt: new Date(Date.UTC(year, month, 1)).toISOString(),
      endsAt: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
    };
  }
  const starts = new Date(window.startsAt),
    ends = window.kind === "provider_cycle" ? new Date(window.endsAt) : null;
  if (!Number.isFinite(starts.getTime()) || (ends && !Number.isFinite(ends.getTime())))
    throw new Error("InvalidInput: window");
  if (now < starts || (ends && now >= ends)) throw new Error("InactiveWindow");
  return {
    epoch: window.kind === "provider_cycle" ? window.cycleId : window.epoch,
    startsAt: starts.toISOString(),
    endsAt: ends?.toISOString() ?? null,
  };
}
