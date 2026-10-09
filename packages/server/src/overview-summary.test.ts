// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { ComponentType } from "react";

const reads = vi.hoisted(() => ({
  usage: {
    state: "ok",
    data: {
      complete: true,
      cost: { text: "12555.5000", unit: "cents", certainty: "measured" },
      measurements: { requests: { text: "12", unit: "requests", certainty: "measured" } },
    },
  },
  budgets: { state: "ok", data: { rows: [{}] } },
}));
vi.mock("@usagekit/react", async (original) => ({
  ...(await original<typeof import("@usagekit/react")>()),
  useUsageSummary: () => reads.usage,
  useBudgetsView: () => reads.budgets,
}));
afterEach(cleanup);
const load = async () =>
  (
    await import(
      /* @vite-ignore */ pathToFileURL(
        join(import.meta.dirname, "../ui/app/pages/overview-summary.tsx"),
      ).href
    )
  ).OverviewSummary as ComponentType<Record<string, unknown>>;

test("failed and incomplete reads clear every old figure, while a known zero stays visible", async () => {
  const Component = await load();
  const props = {
    budgetInput: {
      scope: { namespace: "local", principal: "local", connection: "example" },
      surface: "programmatic",
      units: ["requests"],
    },
    units: ["requests"],
    from: "2026-10-01T00:00:00Z",
    to: "2026-11-01T00:00:00Z",
  };
  const view = render(createElement(Component, props));
  expect(screen.getByText("12555.5000 cents")).toBeTruthy();
  reads.usage = { ...reads.usage, state: "unavailable" };
  reads.budgets = { ...reads.budgets, state: "forbidden" };
  view.rerender(createElement(Component, props));
  expect(screen.queryByText("12555.5000 cents")).toBeNull();
  expect(screen.queryByText("12 requests")).toBeNull();
  expect(screen.queryByText("0 applicable")).toBeNull();
  reads.usage = { ...reads.usage, state: "ok", data: { ...reads.usage.data, complete: false } };
  view.rerender(createElement(Component, props));
  expect(screen.queryByText("12555.5000 cents")).toBeNull();
  reads.usage = {
    state: "ok",
    data: {
      complete: true,
      cost: { text: "0.0000", unit: "cents", certainty: "measured" },
      measurements: { requests: { text: "0", unit: "requests", certainty: "measured" } },
    },
  };
  view.rerender(createElement(Component, props));
  expect(screen.getByText("0.0000 cents")).toBeTruthy();
  expect(screen.getByText("0 requests")).toBeTruthy();
  view.rerender(createElement(Component, { ...props, budgetInput: null }));
  expect(screen.getByText("No connection selected")).toBeTruthy();
  expect(screen.queryByText("1 applicable")).toBeNull();
});
