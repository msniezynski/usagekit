import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createRemoteMeter } from "@usagekit/client";
import { MeterProvider, ProviderManagementProvider, useProviderAction } from "@usagekit/react";
import type { BudgetsInput, ConnectionInput, ProviderBinding } from "@usagekit/views";
import { Button } from "@/components/ui/button";
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

function TokenForm({ onToken }: { onToken: (token: string) => void }) {
  const [value, setValue] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onToken(value.trim());
  };
  return (
    <form onSubmit={submit} className="mx-auto flex max-w-md flex-col gap-3 p-8">
      <label className="flex flex-col gap-1 text-sm">
        <span>Server token</span>
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Kept in memory for this tab only. Reloading the page asks again.
      </p>
      <Button type="submit">Open</Button>
    </form>
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
      <div className="p-6 space-y-3" role="status">
        <p>
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
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-6 min-w-0">
      <nav
        aria-label="Dashboard pages"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {pages.map((item) => (
          <Button
            key={item.id}
            variant={item.id === page ? "default" : "ghost"}
            size="sm"
            aria-current={item.id === page ? "page" : undefined}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Connection history could not be refreshed. Reload this tab to read its latest evidence.
        </p>
      )}
      {page === "overview" && (
        <>
          <div role="group" className="flex flex-wrap gap-2" aria-label="Overview connection">
            {connections.map((item) => (
              <Button
                key={item.id}
                type="button"
                className="h-auto max-w-full whitespace-normal break-all py-2"
                variant={connection?.id === item.id ? "secondary" : "outline"}
                aria-pressed={connection?.id === item.id}
                onClick={() => setSelected(item.id)}
              >
                {item.label ?? item.id}
              </Button>
            ))}
          </div>
          <OverviewPage budgetInput={budgetInput} units={units} />
        </>
      )}
      {page === "budgets" && (
        <BudgetsPage budgetInput={budgetInput} connections={connections} units={units} />
      )}
      {page === "exceptions" && <ExceptionsPage />}
      {page === "connections" && <ConnectionsPage connections={connections} />}
    </div>
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
