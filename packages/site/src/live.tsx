import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  MeterProvider,
  useBudgetsView,
  useCoverageView,
  useExceptionsView,
  useHeaderStatus,
  useUsageSummary,
  useUsageView,
} from "@usagekit/react";
import type { ViewResult } from "@usagekit/react";
import {
  budgetQuery,
  coverageQuery,
  createSiteMeterFixture,
  exceptionsQuery,
  fixtureAccess,
  summaryQuery,
  usageQuery,
} from "./meter-fixture.js";
import type { ProviderName, SiteEvent } from "./meter-fixture.js";
import { seedViews } from "./seed-views.js";

/** At most three sample requests may wait for a receipt at the same time. */
export const maxInFlight = 3;
const latencyMs = { receipt: 900, timeout: 1400 } as const;

export type Live = {
  /** False until the browser seeded its in-memory Meter; views then show the seed snapshot. */
  ready: boolean;
  inFlight: number;
  /** Newest first: six recent events plus older pending ones. An outcome replaces its reservation. */
  events: readonly SiteEvent[];
  problem: string;
  send: (provider?: ProviderName) => void;
  timeout: () => void;
  settleEvidence: (id: string) => void;
  reset: () => void;
};
const LiveContext = createContext<Live | null>(null);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One Meter for the whole page: the hero commands it, every section reads it through hooks. */
export function LiveMeterProvider({ children }: { children: ReactNode }) {
  const [fixture, setFixture] = useState(createSiteMeterFixture);
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<readonly SiteEvent[]>([]);
  const [inFlight, setInFlight] = useState(0);
  const [problem, setProblem] = useState("");
  const flying = useRef(0);
  const generation = useRef(0);
  useEffect(() => {
    let current = true;
    fixture.seed().then(
      () => current && setReady(true),
      () => current && setProblem("The in-memory Meter could not be prepared."),
    );
    return () => {
      current = false;
    };
  }, [fixture]);
  // Six recent events, plus any older pending ones so they can still be settled from evidence.
  const record = useCallback((event: SiteEvent) => {
    setEvents((list) => {
      const next = [event, ...list.filter((item) => item.id !== event.id)];
      return [...next.slice(0, 6), ...next.slice(6).filter((item) => item.status === "pending")];
    });
  }, []);
  const run = useCallback(
    (known: boolean, provider: ProviderName) => {
      if (!ready || flying.current >= maxInFlight) return;
      const own = generation.current;
      flying.current++;
      setInFlight(flying.current);
      void (async () => {
        try {
          const started = await fixture.start(provider);
          if (own !== generation.current) return;
          record(started.event);
          if (started.kind === "blocked") return;
          await wait(known ? latencyMs.receipt : latencyMs.timeout);
          const finished = await fixture.finish(started, known);
          if (own === generation.current) record(finished);
        } catch (error) {
          if (own === generation.current)
            setProblem(error instanceof Error ? error.message : "The sample command failed.");
        } finally {
          if (own === generation.current) {
            flying.current--;
            setInFlight(flying.current);
          }
        }
      })();
    },
    [fixture, ready, record],
  );
  const settleEvidence = useCallback(
    (id: string) => {
      const event = events.find((item) => item.id === id && item.status === "pending");
      if (!ready || !event) return;
      const own = generation.current;
      fixture.settleEvidence(event).then(
        (settled) => own === generation.current && record(settled),
        (error: unknown) =>
          own === generation.current &&
          setProblem(error instanceof Error ? error.message : "The sample evidence failed."),
      );
    },
    [events, fixture, ready, record],
  );
  const reset = useCallback(() => {
    generation.current++;
    flying.current = 0;
    setInFlight(0);
    setEvents([]);
    setProblem("");
    setReady(false);
    setFixture(createSiteMeterFixture());
  }, []);
  const value = useMemo<Live>(
    () => ({
      ready,
      inFlight,
      events,
      problem,
      send: (provider = "language") => run(true, provider),
      timeout: () => run(false, "language"),
      settleEvidence,
      reset,
    }),
    [ready, inFlight, events, problem, run, settleEvidence, reset],
  );
  return (
    <LiveContext.Provider value={value}>
      <MeterProvider meter={fixture.meter} access={fixtureAccess} queryClient={fixture.queryClient}>
        {children}
      </MeterProvider>
    </LiveContext.Provider>
  );
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw Error("useLive needs LiveMeterProvider");
  return live;
}

/** A live view once the Meter is seeded; before that, and in prerendered HTML, the seed. */
function useSeeded<T>(result: ViewResult<T>, seed: T): { view: T; refreshing: boolean } {
  const { ready } = useLive();
  return ready && result.data
    ? { view: result.data, refreshing: result.refreshing }
    : { view: seed, refreshing: false };
}
export const useLiveBudgets = () => useSeeded(useBudgetsView(budgetQuery), seedViews.budgets);
export const useLiveHeader = () => useSeeded(useHeaderStatus(budgetQuery), seedViews.header);
export const useLiveSummary = () => useSeeded(useUsageSummary(summaryQuery), seedViews.summary);
export const useLiveUsage = () => useSeeded(useUsageView(usageQuery), seedViews.usage);
export const useLiveCoverage = () => useSeeded(useCoverageView(coverageQuery), seedViews.coverage);
export const useLiveExceptions = () =>
  useSeeded(useExceptionsView(exceptionsQuery), seedViews.exceptions);
