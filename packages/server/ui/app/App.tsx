import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRemoteMeter } from "@usagekit/client";
import { MeterProvider } from "@usagekit/react";
import type { BudgetsInput, ConnectionInput } from "@usagekit/views";
import { Button } from "@/components/ui/button";
import { BudgetsPage } from "./pages/budgets";
import { ConnectionsPage } from "./pages/connections";
import { ExceptionsPage } from "./pages/exceptions";
import { OverviewPage } from "./pages/overview";
import { loadBudgetUnits, loadConnections, localAccess } from "./session";
import type { Session } from "./session";

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
  const meter = useMemo(
    () =>
      createRemoteMeter({ baseUrl: session.baseUrl, token: session.token, fetch: session.fetch }),
    [session],
  );
  const [page, setPage] = useState<Page>("overview");
  const [connections, setConnections] = useState<ConnectionInput[]>([]);
  const [units, setUnits] = useState<string[]>(["requests"]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([loadConnections(session), loadBudgetUnits(session)]).then(
      ([c, u]) => {
        if (!current) return;
        setConnections(c);
        setUnits(u);
      },
      (e: unknown) => current && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      current = false;
    };
  }, [session]);
  const first = connections[0];
  const budgetInput: BudgetsInput | null = first
    ? {
        scope: { namespace: "local", principal: "local", connection: first.id },
        surface: "programmatic",
        units,
      }
    : null;
  return (
    <MeterProvider meter={meter} access={localAccess}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <nav className="flex flex-wrap gap-2 border-b border-border pb-3">
          {pages.map((p) => (
            <Button
              key={p.id}
              variant={p.id === page ? "default" : "ghost"}
              size="sm"
              aria-current={p.id === page ? "page" : undefined}
              onClick={() => setPage(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </nav>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {`Could not load connections: ${error}`}
          </p>
        )}
        {page === "overview" && <OverviewPage budgetInput={budgetInput} units={units} />}
        {page === "budgets" && <BudgetsPage budgetInput={budgetInput} />}
        {page === "exceptions" && <ExceptionsPage />}
        {page === "connections" && <ConnectionsPage connections={connections} />}
      </div>
    </MeterProvider>
  );
}

export function App({
  baseUrl = globalThis.location?.origin ?? "",
  fetch = globalThis.fetch.bind(globalThis),
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
