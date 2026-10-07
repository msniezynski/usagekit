import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { formatMoney, formatQuantity } from "@usagekit/core";
import type { Operation } from "@usagekit/core";
import { useMeterBinding } from "@usagekit/react";
import { Code } from "./code.js";
import { useLive } from "./live.js";
import { owner } from "./meter-fixture.js";
import { BisibilityMark, Money, SectionHeading } from "./ui.js";

/* Storage: the Store contract, one live transaction, the adapters and how to prove your own. */

/** Inline code in running text. */
const C = ({ children }: { children: ReactNode }) => <code className="store-code">{children}</code>;
/** Code inside tables and the transaction frame: mono without a chip. */
const M = ({ children }: { children: ReactNode }) => <code className="store-mono">{children}</code>;

/** What one accounting command commits in the SQLite and Durable Object adapters. */
const tables: readonly [name: string, purpose: string][] = [
  ["operations", "State and version"],
  ["receipts", "Provider evidence"],
  ["measurements", "What each receipt measured"],
  ["budget_usage", "Spent plus reserved, per budget window"],
  ["commands", "Replay journal"],
  ["budget_alerts", "Alert crossings"],
  ["operation_events", "History for readers"],
];

const guarantees: readonly { title: string; text: string }[] = [
  { title: "All or nothing.", text: "Every table commits or rolls back together." },
  { title: "Exact integers.", text: "No floating point, from estimate to receipt." },
  { title: "Safe to retry.", text: "A repeated command returns its stored result." },
  { title: "Crash-safe.", text: "Dispatched work is recovered from evidence, never sent twice." },
];

const adapters: readonly {
  name: ReactNode;
  key: string;
  durable: "yes" | "no" | "prove";
  entry: ReactNode;
  home: string;
  note: ReactNode;
}[] = [
  {
    key: "memory",
    name: "In-memory",
    durable: "no",
    entry: <M>createMemoryStore</M>,
    home: "@usagekit/store on npm",
    note: "For tests and demos. This page runs on it.",
  },
  {
    key: "sqlite",
    name: "SQLite",
    durable: "yes",
    entry: <M>createSqliteStore</M>,
    home: "Repository",
    note: (
      <>
        Powers <M>usagekit serve</M>. One transaction per command.
      </>
    ),
  },
  {
    key: "durable-objects",
    name: "Cloudflare Durable Objects",
    durable: "yes",
    entry: <M>createDurableObjectStore</M>,
    home: "Repository",
    note: "One object per namespace, so shared budgets have one authority.",
  },
  {
    key: "postgres",
    name: "Postgres",
    durable: "prove",
    entry: <M>Store</M>,
    home: "Your repository",
    note: (
      <>
        How <BisibilityMark size={13} className="store-bisibility" />
        <strong className="store-bisibility-name">bisibility</strong> runs usagekit: its own Store
        on Prisma, with hand-written SQL migrations. It runs alongside its existing billing and is
        tested with usagekit's conformance suite.
      </>
    ),
  },
  {
    key: "any",
    name: "Any transactional database",
    durable: "prove",
    entry: <M>Store</M>,
    home: "Your repository",
    note: "Implement the interface, then prove it with the conformance suite.",
  },
];

const sample = `import { createMemoryStore } from "@usagekit/store";
import { runStoreConformance } from "@usagekit/store/conformance";
import { createMeter } from "@usagekit/meter";
import { createPostgresFixture } from "./postgres-fixture.js"; // yours

// Tests and demos: the in-memory reference Store.
const clock = { now: () => new Date() };
const store = createMemoryStore({ clock, budgets: [] });
const meter = createMeter({ store, clock });

// Your database: the same suite the shipped adapters run.
runStoreConformance(createPostgresFixture, {
  durable: true,
  rollingWindows: false,
  maxMoneyUnits: 2n ** 63n - 1n,
  maxQuantityScale: 18,
});`;

export function StorageSection() {
  return (
    <section className="section store" id="storage" aria-labelledby="storage-title">
      <div className="container">
        <div className="store-inner">
          <SectionHeading id="storage-title" title="One Store contract, any database.">
            The Store commits every command in one transaction, so two concurrent requests can never
            take the same headroom. Use an adapter or bring your own database.
          </SectionHeading>

          <div className="store-block">
            <div className="store-intro">
              <h3 className="store-h3">One command, one transaction.</h3>
              <p className="store-text">
                Headroom, version and lease are re-checked inside the transaction, not before it.
              </p>
            </div>
            <div className="store-panel">
              <Transaction />
              <LatestRecord />
            </div>
            <ul className="store-guarantees" aria-label="Guarantees">
              {guarantees.map(({ title, text }) => (
                <li key={title} className="store-guarantee">
                  <p>
                    <strong>{title}</strong> {text}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="store-block store-split">
            <div className="store-options">
              <h3 className="store-h3">Choose where the ledger lives.</h3>
              <ul className="store-adapters">
                {adapters.map((adapter) => (
                  <li key={adapter.key} className="store-adapter">
                    <div className="store-adapter-head">
                      <h4 className="store-adapter-name">{adapter.name}</h4>
                      <span className="store-adapter-durable">
                        {adapter.durable === "yes"
                          ? "Durable"
                          : adapter.durable === "no"
                            ? "Not durable"
                            : "Proven by the suite"}
                      </span>
                    </div>
                    <p className="store-adapter-meta">
                      <span className="store-adapter-entry">{adapter.entry}</span>
                      <span className="store-adapter-home">{adapter.home}</span>
                    </p>
                    <p className="store-adapter-note">{adapter.note}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="store-proof">
              <Code title="store.test.ts" lang="tsx">
                {sample}
              </Code>
              <p className="store-small">
                Every shipped adapter runs this suite unchanged. Skipped capabilities are reported,
                never counted as passed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Transaction() {
  return (
    <div className="store-tx">
      <p className="store-tx-sql">
        <code>BEGIN IMMEDIATE</code>
      </p>
      <ul className="store-tx-rows" aria-label="Tables one accounting command commits">
        {tables.map(([name, purpose]) => (
          <li key={name} className="store-tx-row">
            <code className="store-tx-table">{name}</code>
            <span className="store-tx-purpose">{purpose}</span>
          </li>
        ))}
      </ul>
      <p className="store-tx-sql">
        <code>COMMIT</code>
      </p>
      <p className="store-tx-note">
        Tables of the SQLite and Durable Object adapters. No prompts or responses are stored.
      </p>
    </div>
  );
}

/* The latest sample command, as the in-memory Store on this page holds it right now. */

type Reading =
  | { kind: "idle" }
  | { kind: "record"; id: string; operation: Operation }
  | { kind: "absent"; id: string; blocked: boolean }
  | { kind: "unreadable"; id: string };

/** Reads the newest hero event's operation through the real Meter whenever that event changes. */
function useLatestRecord(): Reading {
  const { events } = useLive();
  const binding = useMeterBinding();
  const latest = events[0];
  const [reading, setReading] = useState<Reading>({ kind: "idle" });
  useEffect(() => {
    if (!latest || !binding) {
      setReading({ kind: "idle" });
      return;
    }
    let current = true;
    const { id, status } = latest;
    binding.meter
      .getOperation(binding.access, {
        namespace: owner.namespace,
        principal: owner.principal,
        operationId: id,
      })
      .then(
        (result) => {
          if (!current) return;
          if (result.outcome !== "ok") setReading({ kind: "unreadable", id });
          else if (result.value) setReading({ kind: "record", id, operation: result.value });
          else setReading({ kind: "absent", id, blocked: status === "blocked" });
        },
        () => {
          if (current) setReading({ kind: "unreadable", id });
        },
      );
    return () => {
      current = false;
    };
  }, [binding, latest]);
  return latest ? reading : { kind: "idle" };
}

function LatestRecord() {
  const reading = useLatestRecord();
  const operation = reading.kind === "record" ? reading.operation : null;
  return (
    <div className="store-record">
      <div className="store-record-head">
        <h4 className="store-record-title">Latest command</h4>
        {reading.kind === "idle" ? null : <span className="store-record-id">{reading.id}</span>}
      </div>
      <p className="store-record-note">
        Held by the in-memory Store on this page, read with <C>meter.getOperation</C>.
      </p>
      {operation ? (
        <Fields operation={operation} />
      ) : (
        <div className="store-record-empty">
          {reading.kind === "idle" ? (
            <>
              <p>No command yet. Send a request in the console above.</p>
              <a className="store-link" href="#hero-meter-title">
                <ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" />
                Go to the console
              </a>
            </>
          ) : reading.kind === "absent" ? (
            <p>
              {reading.blocked ? (
                <>
                  <span className="store-blocked">Blocked before dispatch.</span> The Store refused
                  the reservation, so it holds no operation for <M>{reading.id}</M>.
                </>
              ) : (
                <>
                  The Store holds no operation for <M>{reading.id}</M>.
                </>
              )}
            </p>
          ) : (
            <p>
              The record for <M>{reading.id}</M> could not be read.
            </p>
          )}
        </div>
      )}
      {reading.kind === "idle" || operation ? <Trail operation={operation} /> : null}
    </div>
  );
}

/** Exact cents text as money; a quantity finer than the cents format stays plain text. */
function Cents({ text }: { text: string }) {
  return /^-?\d+(\.\d{1,4})?$/.test(text) ? <Money cents={text} /> : <span>{text} cents</span>;
}

const heldStates: readonly Operation["state"][] = ["reserved", "dispatch_intended", "pending"];

function Fields({ operation }: { operation: Operation }) {
  const estimate = operation.estimate.find((quantity) => quantity.unit === "cents");
  return (
    <dl className="store-fields">
      <div className="store-field">
        <dt>State</dt>
        <dd>
          <code className="store-state" data-state={operation.state}>
            {operation.state}
          </code>
        </dd>
      </div>
      <div className="store-field">
        <dt>Version</dt>
        <dd className="num">{operation.version}</dd>
      </div>
      <div className="store-field">
        <dt>Estimate</dt>
        <dd>
          {estimate ? <Cents text={formatQuantity(estimate)} /> : "None"}
          {heldStates.includes(operation.state) ? (
            <span className="store-held">
              <span className="store-hatch" aria-hidden="true" />
              reserved
            </span>
          ) : null}
        </dd>
      </div>
      <div className="store-field">
        <dt>Receipts</dt>
        <dd>
          {operation.receipts.length ? (
            <ul className="store-receipts">
              {operation.receipts.map((receipt) => (
                <li key={receipt.id}>
                  {receipt.cost.money ? (
                    <Money cents={formatMoney(receipt.cost.money)} />
                  ) : (
                    <span className="figure-missing">Unknown cost</span>
                  )}
                  <code className="store-receipt-id">{receipt.id}</code>
                </li>
              ))}
            </ul>
          ) : (
            <span className="store-none">None yet</span>
          )}
        </dd>
      </div>
    </dl>
  );
}

type Step = { version: number; states: readonly string[]; command: string | null; via?: string };

/**
 * The versions this sample's commands write. The step at the record's version always shows the
 * state the Store returned; a state the sample never writes there drops the command name.
 */
function trailOf(operation: Operation | null): readonly Step[] {
  const at = operation?.version ?? 0;
  const late = operation?.receipts[0]?.cost.certainty === "unknown";
  const steps: Step[] = [
    { version: 1, states: ["reserved"], command: "reserve" },
    { version: 2, states: ["dispatch_intended"], command: "markDispatchIntent" },
    {
      version: 3,
      states: at >= 3 ? [late ? "pending" : "settled"] : ["settled", "pending"],
      command: "settle",
    },
  ];
  if (late)
    steps.push({ version: 4, states: ["settled"], command: "settle", via: "late evidence" });
  if (!operation) return steps;
  return steps.map((step) =>
    step.version === at && step.states[0] !== operation.state
      ? { version: step.version, states: [operation.state], command: null }
      : step,
  );
}

function Trail({ operation }: { operation: Operation | null }) {
  const at = operation?.version ?? 0;
  return (
    <div className="store-trail">
      <ol className="store-steps" aria-label="Version trail">
        {trailOf(operation).map((step) => {
          const status = step.version < at ? "done" : step.version === at ? "current" : "next";
          return (
            <li
              key={step.version}
              className="store-step"
              data-status={status}
              aria-current={status === "current" ? "step" : undefined}
            >
              <span className="store-step-v num">
                <span aria-hidden="true">v{step.version}</span>
                <span className="sr-only">Version {step.version}</span>
              </span>
              <span className="store-step-state">
                {step.states.map((state, index) => (
                  <span key={state}>
                    {index ? " or " : null}
                    <code className="store-mono" data-state={state}>
                      {state}
                    </code>
                  </span>
                ))}
              </span>
              {step.command ? (
                <span className="store-step-cmd">
                  <span className="sr-only">, written by </span>
                  <code className="store-mono">{step.command}</code>
                  {step.via ? <span className="store-step-via"> from {step.via}</span> : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="store-trail-note">
        Each command names the version it expects. A stale one gets <C>version_conflict</C>.
      </p>
    </div>
  );
}
