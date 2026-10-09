import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { createRemoteMeter } from "@usagekit/client";
import { MeterProvider, ProviderManagementProvider, useProviderAction } from "@usagekit/react";
import type { BudgetsInput, ConnectionInput, ProviderBinding } from "@usagekit/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UsageSegmented, UsageSpinner, usageMotion } from "@/components/usagekit/usage-motion";
import { BudgetsPage } from "./pages/budgets";
import { ConnectionsPage } from "./pages/connections";
import { ExceptionsPage } from "./pages/exceptions";
import { OverviewPage } from "./pages/overview";
import { loadBudgetUnits, loadConnections, localAccess } from "./session";
import type { Session } from "./session";
import { loadProviderBinding, createProviderPort, createBudgetWriter } from "./management-client";

const pages = [
  { id: "overview", label: "Overview" },
  { id: "budgets", label: "Budgets" },
  { id: "exceptions", label: "Exceptions" },
  { id: "connections", label: "Connections" },
] as const;
type Page = (typeof pages)[number]["id"];

/** The Usagekit mark and wordmark, as on the project website. */
function Brand() {
  return (
    <span className="flex items-center gap-2">
      <svg aria-hidden viewBox="0 0 32 32" className="size-[22px] shrink-0 text-foreground">
        <path
          d="M5 6v12a11 11 0 0 0 22 0V6M12 6v12a4 4 0 0 0 8 0V6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
      <span className="text-[17px] leading-none font-semibold tracking-[-0.03em]">
        usagekit
        <span aria-hidden className="text-brand">
          .
        </span>
      </span>
    </span>
  );
}

function TokenForm({ onToken }: { onToken: (token: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onToken(value.trim());
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <form
        onSubmit={submit}
        className={`w-full max-w-sm space-y-5 rounded-xl border border-border bg-background p-6 ${usageMotion.enter}`}
      >
        <div className="flex items-center gap-2.5">
          <Brand />
          <Badge variant="outline">local</Badge>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Open the local dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Paste the token the server printed when it started.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="server-token">Server token</Label>
          <Input
            id="server-token"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Kept in memory for this tab only. Reloading the page asks again.
          </p>
        </div>
        <Button type="submit" className="w-full">
          Open
        </Button>
      </form>
    </main>
  );
}

function Shell({ session }: { session: Session }) {
  const retained = useRef({ session, epoch: 0 });
  if (retained.current.session !== session)
    retained.current = { session, epoch: retained.current.epoch + 1 };
  return <VerifiedDashboard key={retained.current.epoch} session={session} />;
}
function VerifiedDashboard({ session }: { session: Session }) {
  const meter = useMemo(
    () =>
      createRemoteMeter({ baseUrl: session.baseUrl, token: session.token, fetch: session.fetch }),
    [session],
  );
  const port = useMemo(() => createProviderPort(session), [session]);
  const writer = useMemo(() => createBudgetWriter(session), [session]);
  const [metadata, setMetadata] = useState<{
    binding: ProviderBinding;
    connections: ConnectionInput[];
    units: string[];
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    Promise.all([
      loadProviderBinding(session),
      loadConnections(session),
      loadBudgetUnits(session),
    ]).then(
      ([binding, connections, units]) => {
        if (current) {
          setMetadata({ binding, connections, units });
          setError(false);
        }
      },
      () => {
        if (current) setError(true);
      },
    );
    return () => {
      current = false;
    };
  }, [session, attempt]);
  if (!metadata)
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div role="status" className={`max-w-sm space-y-3 text-center ${usageMotion.enter}`}>
          <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {!error && <UsageSpinner />}
            {error ? "Could not open the authenticated local dashboard." : "Loading server access…"}
          </p>
          {error && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(false);
                setAttempt(attempt + 1);
              }}
            >
              Retry connection
            </Button>
          )}
        </div>
      </main>
    );
  return (
    <MeterProvider
      meter={meter}
      access={{ ...localAccess, canManageBudgets: metadata.binding.canManage === true }}
      {...(metadata.binding.canManage === true ? { budgetWriter: writer } : {})}
    >
      <ProviderManagementProvider port={port} binding={metadata.binding}>
        <Dashboard
          session={session}
          initialConnections={metadata.connections}
          units={metadata.units}
        />
      </ProviderManagementProvider>
    </MeterProvider>
  );
}
function Dashboard({
  session,
  initialConnections,
  units,
}: {
  session: Session;
  initialConnections: ConnectionInput[];
  units: readonly string[];
}) {
  const [page, setPage] = useState<Page>("overview");
  const [connections, setConnections] = useState(initialConnections);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const action = useProviderAction();
  useEffect(() => {
    if (action.result?.outcome !== "success") return;
    let current = true;
    loadConnections(session).then(
      (value) => {
        if (current) {
          setConnections(value);
          setError(false);
        }
      },
      () => {
        if (current) setError(true);
      },
    );
    return () => {
      current = false;
    };
  }, [session, action.result]);
  const connection = connections.find((item) => item.id === selected) ?? connections[0];
  const budgetInput: BudgetsInput | null = connection
    ? {
        scope: { namespace: "local", principal: "local", connection: connection.id },
        surface: "programmatic",
        units,
      }
    : null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:px-6">
          <span className="flex items-center gap-2.5 pb-3">
            <Brand />
            <Badge variant="outline">local</Badge>
          </span>
          <PageTabs page={page} onPage={setPage} />
        </div>
      </header>
      <main className="mx-auto flex max-w-7xl min-w-0 flex-col gap-6 p-4 sm:p-6">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Connection history could not be refreshed. Reload this tab to read its latest evidence.
          </p>
        )}
        <div key={page} className={`flex min-w-0 flex-col gap-6 ${usageMotion.enter}`}>
          {page === "overview" && (
            <>
              {connections.length > 0 && (
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">Connection</span>
                  <UsageSegmented
                    label="Overview connection"
                    value={connection?.id ?? null}
                    options={connections.map((item) => ({
                      value: item.id,
                      label: item.label ?? item.id,
                    }))}
                    onChange={setSelected}
                  />
                </div>
              )}
              <OverviewPage budgetInput={budgetInput} units={units} />
            </>
          )}
          {page === "budgets" && (
            <BudgetsPage budgetInput={budgetInput} connections={connections} units={units} />
          )}
          {page === "exceptions" && <ExceptionsPage />}
          {page === "connections" && <ConnectionsPage connections={connections} />}
        </div>
      </main>
    </div>
  );
}

/** Page navigation; the underline slides to the current page. */
function PageTabs({ page, onPage }: { page: Page; onPage: (page: Page) => void }) {
  const nav = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (current) setIndicator({ left: current.offsetLeft, width: current.offsetWidth });
  }, [page]);
  return (
    <nav
      ref={nav}
      aria-label="Dashboard pages"
      className="relative -mb-px flex gap-0.5 overflow-x-auto sm:gap-1"
    >
      {pages.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={item.id === page ? "page" : undefined}
          onClick={() => onPage(item.id)}
          className={`shrink-0 rounded-md px-2 pt-1.5 pb-3 text-sm font-medium outline-none sm:px-3 focus-visible:ring-2 focus-visible:ring-ring ${item.id === page ? "text-foreground" : "text-muted-foreground hover:text-foreground"} ${usageMotion.respond}`}
        >
          {item.label}
        </button>
      ))}
      {indicator && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-0.5 w-[var(--tab-width)] translate-x-[var(--tab-left)] rounded-full bg-foreground transition-[translate,width] duration-300 ease-out motion-reduce:transition-none"
          style={
            {
              "--tab-left": `${indicator.left}px`,
              "--tab-width": `${indicator.width}px`,
            } as CSSProperties
          }
        />
      )}
    </nav>
  );
}
const browserFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

export function App({
  baseUrl = globalThis.location?.origin ?? "",
  fetch = browserFetch,
}: {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}) {
  const [token, setToken] = useState<string | null>(null);
  const session = useMemo(
    () => (token ? { baseUrl, token, fetch } : null),
    [baseUrl, token, fetch],
  );
  return session ? <Shell session={session} /> : <TokenForm onToken={setToken} />;
}
