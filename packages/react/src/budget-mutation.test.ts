import { createElement } from "react";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createManualClock, createMemoryStore } from "@usagekit/store";
import { createMeter } from "@usagekit/meter";
import type { AccessContext, Budget } from "@usagekit/core";
import {
  MeterProvider,
  useBudgetMutation,
  useBudgetEditor,
  useDefinedBudgets,
  useBudgetsView,
  useHeaderStatus,
  createMeterQueryClient,
} from "./index.js";
import type { BudgetSaveResult, BudgetWriter } from "./index.js";

afterEach(cleanup);
const access: AccessContext = {
  namespace: "test",
  readablePrincipals: ["a"],
  readableGroups: [],
  readablePools: [],
  canReadBillingDetail: true,
  canManageBudgets: true,
};
const cap: Budget = {
  id: "cap",
  version: 1,
  scope: { kind: "principal", namespace: "test", principal: "a" },
  surface: "any",
  unit: "requests",
  limit: { value: 10n, scale: 0, unit: "requests" },
  window: { kind: "calendar_month", timezone: "UTC" },
  onExceed: "block",
};
const next = { ...cap, version: 2, limit: { ...cap.limit!, value: 20n } };
const options = { scope: cap.scope, budgetId: cap.id };
const budgetInput = {
  scope: { namespace: "test", principal: "a", connection: "c" },
  surface: "app" as const,
  units: ["requests"],
};
function fixture(writer: BudgetWriter, overrides?: Partial<AccessContext>) {
  const budgets = [cap];
  const clock = createManualClock();
  const meter = createMeter({ store: createMemoryStore({ clock, budgets }), clock });
  const queryClient = createMeterQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      MeterProvider,
      { meter, access: { ...access, ...overrides }, budgetWriter: writer, queryClient },
      children,
    );
  return { budgets, meter, wrapper, queryClient };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("a confirmed save invalidates definitions and shared budget/header reads against the actual Meter", async () => {
  const save = vi.fn(async (b: Budget): Promise<BudgetSaveResult> => {
    f.budgets[0] = b;
    return { outcome: "saved", budget: b };
  });
  const f = fixture({ save });
  const spy = vi.spyOn(f.meter, "applicableBudgets");
  const { result } = renderHook(
    () => ({
      definitions: useDefinedBudgets({ scope: cap.scope }),
      budgets: useBudgetsView(budgetInput),
      header: useHeaderStatus(budgetInput),
      mutation: useBudgetMutation(options),
    }),
    { wrapper: f.wrapper },
  );
  await waitFor(() => expect(result.current.budgets.state).toBe("ok"));
  expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.mutation.save(next);
  });
  await waitFor(() => expect(result.current.definitions.data?.budgets[0]?.version).toBe(2));
  expect(result.current.budgets.data?.rows[0]?.limit).toMatchObject({ text: "20" });
  expect(result.current.header.data?.bounds[0]?.remaining).toMatchObject({ text: "20" });
  expect(spy).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledTimes(1);
});

test("no host writer and missing management permission both fail closed", async () => {
  const save = vi.fn();
  const f = fixture({ save }, { canManageBudgets: false });
  const denied = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  expect(denied.result.current.canWrite).toBe(false);
  await act(async () => {
    expect(await denied.result.current.save(next)).toEqual({ outcome: "forbidden" });
  });
  const readonly = renderHook(() => useBudgetMutation({ ...options, meter: f.meter, access }));
  expect(readonly.result.current.canWrite).toBe(false);
  await act(async () => {
    expect(await readonly.result.current.save(next)).toEqual({ outcome: "forbidden" });
  });
  expect(save).not.toHaveBeenCalled();
});

test("ambiguous writes block reset and duplicate submits across editor remounts until exact reconciliation", async () => {
  const save = vi.fn().mockRejectedValue(new Error("response lost"));
  const f = fixture({ save });
  const first = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  await act(async () => {
    await first.result.current.save(next);
  });
  expect(first.result.current).toMatchObject({ state: "unavailable", ambiguous: true });
  act(() => first.result.current.reset());
  expect(first.result.current.ambiguous).toBe(true);
  first.unmount();
  const second = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  expect(second.result.current.ambiguous).toBe(true);
  await act(async () => {
    await second.result.current.save(next);
    await second.result.current.reconcile();
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(second.result.current.ambiguous).toBe(true);
  f.budgets[0] = structuredClone(next);
  await act(async () => {
    expect(await second.result.current.reconcile()).toEqual({ outcome: "saved", budget: next });
  });
  expect(second.result.current.ambiguous).toBe(false);
});

test("an authoritative not_saved result releases ambiguity without automatically retrying", async () => {
  const save = vi.fn().mockRejectedValue(new Error("unknown"));
  const reconcile = vi.fn().mockResolvedValue({ outcome: "not_saved" });
  const f = fixture({ save, reconcile });
  const { result } = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  await act(async () => {
    await result.current.save(next);
    await result.current.reconcile();
  });
  expect(result.current).toMatchObject({ state: "idle", ambiguous: false });
  expect(save).toHaveBeenCalledTimes(1);
  expect(reconcile).toHaveBeenCalledWith(next);
});

test("conflict refreshes definitions, keeps the user's draft and never silently bumps/retries", async () => {
  const save = vi.fn().mockResolvedValue({ outcome: "conflict", reason: "budget_version" });
  const f = fixture({ save });
  const { result } = renderHook(() => useBudgetEditor({ budget: cap }), { wrapper: f.wrapper });
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "30" })));
  await act(async () => {
    await result.current.save();
  });
  expect(result.current).toMatchObject({ state: "conflict", draft: { limit: "30" }, dirty: true });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith({
    ...next,
    alerts: [],
    limit: { value: 30n, scale: 0, unit: "requests" },
  });
});

test("pending writes retain an immutable original body and cannot grant a second submit", async () => {
  const pending = deferred<BudgetSaveResult>();
  const save = vi.fn().mockReturnValue(pending.promise);
  const f = fixture({ save });
  const { result } = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  const body = structuredClone(next);
  let reply!: Promise<BudgetSaveResult>;
  act(() => {
    reply = result.current.save(body);
  });
  body.limit!.value = 99n;
  await act(async () => {
    await result.current.save(body);
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]?.[0].limit.value).toBe(20n);
  expect(Object.isFrozen(save.mock.calls[0]?.[0].limit)).toBe(true);
  await act(async () => {
    pending.resolve({ outcome: "saved", budget: next });
    await reply;
  });
});

test("authorization change fences retained callbacks and discards the old save reply", async () => {
  const pending = deferred<BudgetSaveResult>();
  const save = vi.fn().mockReturnValue(pending.promise);
  const f = fixture({ save });
  const writer = { save };
  const { result, rerender } = renderHook(
    (a: AccessContext) =>
      useBudgetMutation({
        ...options,
        meter: f.meter,
        access: a,
        queryClient: f.queryClient,
        budgetWriter: writer,
      }),
    { initialProps: access },
  );
  const oldSave = result.current.save;
  let reply!: Promise<BudgetSaveResult>;
  act(() => {
    reply = oldSave(next);
  });
  rerender({ ...access, readablePrincipals: [], canManageBudgets: false });
  expect(result.current.result).toBeNull();
  expect(result.current.canWrite).toBe(false);
  await act(async () => {
    expect(await oldSave(next)).toEqual({ outcome: "forbidden" });
    pending.resolve({ outcome: "saved", budget: next });
    expect(await reply).toEqual({ outcome: "forbidden" });
  });
  expect(save).toHaveBeenCalledTimes(1);
  expect(result.current.result).toBeNull();
});

test("new templates create version1 with exact large decimals and fixed authority fields", async () => {
  const save = vi.fn(
    async (budget: Budget): Promise<BudgetSaveResult> => ({ outcome: "saved", budget }),
  );
  const f = fixture({ save });
  const { limit: _limit, onExceed: _onExceed, ...template } = cap;
  const { result } = renderHook(() => useBudgetEditor({ budget: { ...template, version: 0 } }), {
    wrapper: f.wrapper,
  });
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "9007199254740993.01" })));
  await act(async () => {
    await result.current.save();
  });
  expect(save.mock.calls[0]?.[0]).toMatchObject({
    version: 1,
    scope: cap.scope,
    window: cap.window,
    unit: "requests",
    limit: { value: 900719925474099301n, scale: 2 },
  });
});

test("invalid drafts never call the host and reset never erases an unknown request", async () => {
  const save = vi.fn().mockRejectedValue(new Error("lost"));
  const f = fixture({ save });
  const { result } = renderHook(() => useBudgetEditor({ budget: cap }), { wrapper: f.wrapper });
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "-1" })));
  await act(async () => {
    expect((await result.current.save()).outcome).toBe("invalid");
  });
  expect(save).not.toHaveBeenCalled();
  expect(result.current.errors?.field).toBe("limit");
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "20" })));
  await act(async () => {
    await result.current.save();
  });
  act(() => {
    result.current.reset();
    result.current.setDraft((draft) => ({ ...draft, limit: "99" }));
  });
  expect(result.current.draft.limit).toBe("20");
  expect(result.current.ambiguous).toBe(true);
});

test("a verified newer base clears conflict, preserves the draft and allows the next version", async () => {
  const save = vi
    .fn()
    .mockResolvedValueOnce({ outcome: "conflict", reason: "budget_version" })
    .mockImplementation(async (budget: Budget) => ({ outcome: "saved", budget }));
  const f = fixture({ save });
  const { result, rerender } = renderHook((budget: Budget) => useBudgetEditor({ budget }), {
    wrapper: f.wrapper,
    initialProps: cap,
  });
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "30" })));
  await act(async () => {
    await result.current.save();
  });
  expect(result.current.state).toBe("conflict");
  rerender(next);
  await waitFor(() => expect(result.current.state).toBe("idle"));
  expect(result.current.draft.limit).toBe("30");
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "40" })));
  await act(async () => {
    await result.current.save();
  });
  expect(save.mock.calls[1]?.[0]).toMatchObject({ version: 3, limit: { value: 40n } });
});

test("replacing the writer or advancing a prop version cannot clear an ambiguous write", async () => {
  const save = vi.fn().mockRejectedValue(new Error("lost"));
  const f = fixture({ save });
  const replacement = vi.fn();
  const { result, rerender } = renderHook(
    (props: { writer: BudgetWriter; budget: Budget }) =>
      useBudgetEditor({
        budget: props.budget,
        meter: f.meter,
        access,
        queryClient: f.queryClient,
        budgetWriter: props.writer,
      }),
    { initialProps: { writer: { save }, budget: cap } },
  );
  await act(async () => {
    await result.current.save();
  });
  expect(result.current.ambiguous).toBe(true);
  rerender({ writer: { save: replacement }, budget: next });
  expect(result.current.ambiguous).toBe(true);
  expect(result.current.draft.limit).toBe("10");
  await act(async () => {
    await result.current.save();
  });
  expect(replacement).not.toHaveBeenCalled();
});

test("a callback from before authorization changed stays fenced even after the same access returns", async () => {
  const save = vi.fn(
    async (budget: Budget): Promise<BudgetSaveResult> => ({ outcome: "saved", budget }),
  );
  const writer = { save };
  const f = fixture(writer);
  const { result, rerender } = renderHook(
    (a: AccessContext) =>
      useBudgetMutation({
        ...options,
        meter: f.meter,
        access: a,
        queryClient: f.queryClient,
        budgetWriter: writer,
      }),
    { initialProps: access },
  );
  const oldSave = result.current.save;
  rerender({ ...access, canManageBudgets: false });
  rerender(access);
  await act(async () => {
    expect(await oldSave(next)).toEqual({ outcome: "forbidden" });
  });
  expect(save).not.toHaveBeenCalled();
});

test("a reply from before authorization changed requires reconciliation when the same access returns", async () => {
  const pending = deferred<BudgetSaveResult>();
  const save = vi.fn().mockReturnValue(pending.promise);
  const writer = { save };
  const f = fixture(writer);
  const { result, rerender } = renderHook(
    (a: AccessContext) =>
      useBudgetMutation({
        ...options,
        meter: f.meter,
        access: a,
        queryClient: f.queryClient,
        budgetWriter: writer,
      }),
    { initialProps: access },
  );
  let reply!: Promise<BudgetSaveResult>;
  act(() => {
    reply = result.current.save(next);
  });
  rerender({ ...access, canManageBudgets: false });
  rerender(access);
  await act(async () => {
    pending.resolve({ outcome: "saved", budget: next });
    expect(await reply).toEqual({ outcome: "forbidden" });
  });
  expect(result.current).toMatchObject({ state: "unavailable", ambiguous: true, pending: false });
  expect(save).toHaveBeenCalledTimes(1);
  f.budgets[0] = next;
  await act(async () => {
    expect((await result.current.reconcile()).outcome).toBe("saved");
  });
  expect(result.current.ambiguous).toBe(false);
});

test("a standalone editor adopts each confirmed save without a parent budget update", async () => {
  const save = vi.fn(
    async (budget: Budget): Promise<BudgetSaveResult> => ({ outcome: "saved", budget }),
  );
  const f = fixture({ save });
  const { result } = renderHook(() => useBudgetEditor({ budget: cap }), { wrapper: f.wrapper });
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "20" })));
  await act(async () => {
    expect((await result.current.save()).outcome).toBe("saved");
  });
  expect(result.current.dirty).toBe(false);
  expect(result.current.draft.limit).toBe("20");
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "30" })));
  await act(async () => {
    await result.current.save();
  });
  expect(save.mock.calls.map(([budget]) => budget.version)).toEqual([2, 3]);
  expect(result.current).toMatchObject({ dirty: false, draft: { limit: "30" } });
});

test("an unmounted editor cannot start a write using its retained callback", async () => {
  const save = vi.fn(
    async (budget: Budget): Promise<BudgetSaveResult> => ({ outcome: "saved", budget }),
  );
  const f = fixture({ save });
  const { result, unmount } = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  const oldSave = result.current.save;
  unmount();
  expect(await oldSave(next)).toEqual({ outcome: "forbidden" });
  expect(save).not.toHaveBeenCalled();
});

test("an unmounted write reply is forbidden and the shared retained body still reconciles", async () => {
  const pending = deferred<BudgetSaveResult>();
  const save = vi.fn().mockReturnValue(pending.promise);
  const f = fixture({ save });
  const first = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  let reply!: Promise<BudgetSaveResult>;
  act(() => {
    reply = first.result.current.save(next);
  });
  first.unmount();
  pending.resolve({ outcome: "saved", budget: next });
  expect(await reply).toEqual({ outcome: "forbidden" });
  const second = renderHook(() => useBudgetMutation(options), { wrapper: f.wrapper });
  expect(second.result.current).toMatchObject({ state: "unavailable", ambiguous: true });
  f.budgets[0] = next;
  await act(async () => {
    expect((await second.result.current.reconcile()).outcome).toBe("saved");
  });
  expect(save).toHaveBeenCalledTimes(1);
});

test("a newer external budget takes precedence over a standalone saved base", async () => {
  const save = vi.fn(
    async (budget: Budget): Promise<BudgetSaveResult> => ({ outcome: "saved", budget }),
  );
  const f = fixture({ save });
  const { result, rerender } = renderHook((budget: Budget) => useBudgetEditor({ budget }), {
    wrapper: f.wrapper,
    initialProps: cap,
  });
  await act(async () => {
    await result.current.save();
  });
  rerender({ ...cap, version: 4, limit: { ...cap.limit!, value: 40n } });
  expect(result.current).toMatchObject({ dirty: false, draft: { limit: "40" } });
  act(() => result.current.setDraft((draft) => ({ ...draft, limit: "50" })));
  await act(async () => {
    await result.current.save();
  });
  expect(save.mock.calls.map(([budget]) => budget.version)).toEqual([2, 5]);
});
