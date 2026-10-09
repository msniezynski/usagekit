import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@base-ui/react/button";
import { AppWindow, ArrowUpRight, KeyRound, RotateCcw, Send, SquareTerminal } from "lucide-react";
import type { BudgetRow } from "@usagekit/views";
import { useAnnouncer } from "./announce.js";
import { Code, Install } from "./code.js";
import {
  installPackages,
  npmPackage,
  readHooks,
  reactPackages,
  runtimePackages,
  runtimeVersion,
} from "./content.js";
import { maxInFlight, useLive, useLiveBudgets } from "./live.js";
import type { Live } from "./live.js";
import { BisibilityLockup, BisibilityMark, Money, SectionHeading } from "./ui.js";

const icon = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;

/* Hooks: a host component next to the exact view model it receives on this page. */

/** Lines stay within 51 characters so the source fits its 5fr column without scrolling. */
const hooksSource = [
  'import { useBudgetsView } from "@usagekit/react";',
  'import type { Scope } from "@usagekit/core";',
  "// Bar, Money and Notice are your own components.",
  "",
  "type Props = { scope: Scope };",
  "",
  "export function SpendBudget({ scope }: Props) {",
  "  // Equal reads share one cache entry.",
  "  const { data, state, refresh } = useBudgetsView({",
  "    scope,",
  '    surface: "app",',
  '    units: ["cents"],',
  "  });",
  "",
  '  if (state === "loading") return <Notice busy />;',
  '  if (state !== "ok" || !data) return (',
  "    <Notice state={state} onRetry={refresh} />",
  "  );",
  "",
  "  return data.rows.map((row) => (",
  "    <section key={row.id} data-level={row.level}>",
  "      <Money amount={row.remaining} /> left",
  "      <Bar geometry={row.bar} />",
  "    </section>",
  "  ));",
  "}",
].join("\n");

type TokenKind = "key" | "punc" | "string" | "null" | "comment";
/** One rendered token; leaves carry a path so a changed value can be marked. */
type Token = { text: string; kind: TokenKind; path?: string };
type Line = { depth: 0 | 1 | 2; tokens: readonly Token[] };

/** A no-break space keeps "key: value" together; lines wrap only between fields. */
const nb = String.fromCharCode(0xa0);
const key = (text: string): Token => ({ text, kind: "key" });
const punc = (text: string): Token => ({ text, kind: "punc" });
const leaf = (path: string, value: string | null): Token =>
  value === null
    ? { text: "null", kind: "null", path }
    : { text: `"${value}"`, kind: "string", path };
type Value = string | null | readonly string[];
type Entries = readonly (readonly [string, Value])[];
const valueTokens = (path: string, value: Value): Token[] =>
  typeof value === "string" || value === null
    ? [leaf(path, value)]
    : [
        punc("["),
        ...value.flatMap((item, index) => [
          ...(index ? [punc(", ")] : []),
          leaf(`${path}.${index}`, item),
        ]),
        punc("]"),
      ];

/** One property line; an object value is written inline as { key: value, ... }. */
function property(name: string, value: Value | { fields: Entries }): Line {
  const head = [key(name), punc(`:${nb}`)];
  if (value === null || typeof value === "string" || !("fields" in value))
    return { depth: 1, tokens: [...head, ...valueTokens(name, value), punc(",")] };
  return {
    depth: 1,
    tokens: [
      ...head,
      punc(`{${nb}`),
      ...value.fields.flatMap(([field, item], index) => [
        ...(index ? [punc(", ")] : []),
        key(field),
        punc(`:${nb}`),
        ...valueTokens(`${name}.${field}`, item),
      ]),
      punc(`${nb}},`),
    ],
  };
}
const amount = (value: BudgetRow["used"] | BudgetRow["limit"]): Value | { fields: Entries } =>
  typeof value === "string"
    ? value
    : {
        fields: [
          ["text", value.text],
          ["unit", value.unit],
          ["certainty", value.certainty],
        ],
      };

/** data.rows[0] as an object literal: the fields a budget component renders. */
function rowLines(row: BudgetRow | undefined): readonly Line[] {
  if (!row) return [{ depth: 0, tokens: [{ text: "undefined", kind: "null", path: "row" }] }];
  const bar = row.bar;
  return [
    { depth: 0, tokens: [punc("{")] },
    property("used", amount(row.used)),
    property("reserved", amount(row.reserved)),
    property("remaining", amount(row.remaining)),
    property("limit", amount(row.limit)),
    property("level", row.level),
    property(
      "bar",
      bar
        ? {
            fields: [
              ["used", bar.used],
              ["reserved", bar.reserved],
              ["limit", bar.limit],
              ["hardLimit", bar.hardLimit],
              ["alerts", bar.alerts],
            ],
          }
        : null,
    ),
    {
      depth: 1,
      tokens: [{ text: "// plus id, window, resetsAt, boundary and more", kind: "comment" }],
    },
    { depth: 0, tokens: [punc("}")] },
  ];
}

const unchanged: ReadonlySet<string> = new Set();
/** Paths whose value differs from the previous render, cleared shortly after the last change. */
function useChangedPaths(lines: readonly Line[]): ReadonlySet<string> {
  const values = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of lines)
      for (const token of line.tokens) if (token.path) map.set(token.path, token.text);
    return map;
  }, [lines]);
  const signature = JSON.stringify([...values]);
  const previous = useRef<ReadonlyMap<string, string> | null>(null);
  const [changed, setChanged] = useState(unchanged);
  useEffect(() => {
    const before = previous.current;
    previous.current = values;
    if (!before) return;
    const next = new Set<string>();
    for (const [path, text] of values) if (before.get(path) !== text) next.add(path);
    setChanged(next.size ? next : unchanged);
    if (!next.size) return;
    const timer = setTimeout(() => setChanged(unchanged), 1800);
    return () => clearTimeout(timer);
    // The signature names the values; a new Map with equal values is not a change.
  }, [signature]);
  return changed;
}

/** The newest sample request in words, with exact amounts. */
function readoutStatus({ ready, problem, events }: Live): ReactNode {
  if (problem) return problem;
  const event = events[0];
  if (!ready || !event) return "Sample requests run against the in-memory Meter only.";
  const estimate = <Money cents={event.estimate} />;
  const actual = event.actual ? <Money cents={event.actual} /> : "the exact cost";
  switch (event.status) {
    case "reserved":
      return <>Reserved {estimate} before dispatch. Waiting for the receipt.</>;
    case "settled":
      return <>Settled {actual} from the receipt. The hold is released.</>;
    case "pending":
      return <>No cost on the receipt, so {estimate} stays reserved.</>;
    case "evidence":
      return <>Late evidence settled {actual}. The hold is released.</>;
    case "blocked":
      return <>Blocked before dispatch: {estimate} would pass the limit.</>;
  }
}

const tokenClass: Record<TokenKind, string> = {
  key: "hooks-key",
  punc: "hooks-punc",
  string: "tok-string",
  null: "tok-keyword",
  comment: "tok-comment",
};

function BudgetReadout() {
  const live = useLive();
  const { view } = useLiveBudgets();
  const row = view.rows[0];
  const lines = useMemo(() => rowLines(row), [row]);
  const changed = useChangedPaths(lines);
  const sendButton = useRef<HTMLButtonElement>(null);
  // This page has no console log, so the readout announces the requests it sends itself.
  const announcer = useAnnouncer(live);
  return (
    <div className="hooks-readout">
      <div className="hooks-readout-head">
        <h3 className="hooks-readout-title">What your component receives</h3>
        <p className="hooks-readout-note">
          The live output of <code className="sec-code">useBudgetsView</code> on this page, read
          from the sample in-memory Meter.
        </p>
      </div>
      <pre
        className="hooks-readout-body"
        tabIndex={0}
        role="region"
        aria-label="Live value of data.rows[0]"
      >
        <code>
          <span className="hooks-line hooks-d0">
            <span className="tok-comment">{"// data.rows[0]"}</span>
            {"\n"}
          </span>
          {lines.map((line, index) => {
            const marked = line.tokens.some((token) => token.path && changed.has(token.path));
            return (
              <span
                key={index}
                className={`hooks-line hooks-d${line.depth}${marked ? " is-changed" : ""}`}
              >
                {line.tokens.map((token, at) => (
                  <span
                    key={at}
                    className={
                      token.path
                        ? `${tokenClass[token.kind]} hooks-leaf${changed.has(token.path) ? " is-changed" : ""}`
                        : tokenClass[token.kind]
                    }
                  >
                    {token.text}
                  </span>
                ))}
                {"\n"}
              </span>
            );
          })}
        </code>
      </pre>
      <div className="hooks-readout-foot">
        <div className="hooks-readout-actions">
          <Button
            ref={sendButton}
            className="btn btn-outline btn-sm"
            disabled={!live.ready || live.inFlight >= maxInFlight}
            focusableWhenDisabled
            onClick={() => {
              announcer.claim();
              live.send();
            }}
          >
            <Send {...icon} />
            Send a sample request
          </Button>
          {live.events[0]?.status === "blocked" ? (
            <Button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                live.reset();
                announcer.say("Sample reset to its starting monthly spend.");
                // The reset removes this button; focus stays in the readout.
                sendButton.current?.focus();
              }}
            >
              <RotateCcw {...icon} />
              Reset the sample
            </Button>
          ) : null}
        </div>
        <p className="hooks-readout-status">{readoutStatus(live)}</p>
        <p className="sr-only" aria-live="polite">
          {announcer.said.text ? (
            <span key={announcer.said.count}>{announcer.said.text}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export function HooksSection() {
  return (
    <section className="section sec-hooks" id="hooks" aria-labelledby="hooks-title">
      <div className="container">
        <SectionHeading id="hooks-title" title="Or take only the hooks.">
          Headless hooks return exact view models with explicit states. Equal reads share one cache,
          so a header badge and a dashboard never disagree.
        </SectionHeading>
        <div className="hooks-grid">
          <Code title="spend-budget.tsx" className="hooks-code">
            {hooksSource}
          </Code>
          <BudgetReadout />
          <div className="hooks-more">
            <h3 className="hooks-more-title">Read hooks</h3>
            <ul className="hooks-chips">
              {readHooks.map((name) => (
                <li key={name}>
                  <code className="hooks-chip">{name}</code>
                </li>
              ))}
            </ul>
            <p className="hooks-provider">
              Provider hooks read connections, balances, quotes and allocations through a port your
              application supplies.{" "}
              <a className="link" href="/docs/#providers">
                About provider hooks
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Lifecycle: four steps over one server-side flow. */

type Step = "reserve" | "dispatch" | "settle" | "read";
/** Each step names the operation states it can leave behind, as LifecycleState values. */
const steps: readonly { id: Step; name: string; text: string; states: readonly string[] }[] = [
  {
    id: "reserve",
    name: "Reserve",
    text: "Hold the estimate first. No headroom, no dispatch.",
    states: ["reserved"],
  },
  {
    id: "dispatch",
    name: "Dispatch",
    text: "Take the single grant, then call the provider once.",
    states: ["dispatch_intended"],
  },
  {
    id: "settle",
    name: "Settle",
    text: "Book the receipt's exact cost. Unknown stays reserved.",
    states: ["settled", "pending"],
  },
  {
    id: "read",
    name: "Read",
    text: "Show users authorized views of the same accounting.",
    states: [],
  },
];

/**
 * Illustrative, accurate flow; each line names the step it belongs to. Lines stay within 71
 * characters so the source fits its 7fr column without scrolling.
 */
const flowLines: readonly (readonly [Step | null, string])[] = [
  [null, 'import type { AccessContext, MeterReserveInput } from "@usagekit/core";'],
  [null, 'import { loadBudgetsView } from "@usagekit/views";'],
  [null, 'import { callProvider, meter } from "./server";'],
  [null, ""],
  [null, "export async function meteredCall("],
  [null, "  access: AccessContext,"],
  [null, "  input: MeterReserveInput,"],
  [null, ") {"],
  ["reserve", "  const reserved = await meter.reserve(input);"],
  ["reserve", '  if (reserved.outcome !== "reserved") return reserved;'],
  ["reserve", "  if (reserved.replayed) return reserved; // A replay never dispatches."],
  [null, ""],
  ["dispatch", "  const { namespace, principal } = input.scope;"],
  ["dispatch", "  const ref = { namespace, principal, operationId: input.operationId };"],
  ["dispatch", "  const grant = await meter.markDispatchIntent({"],
  ["dispatch", "    ...ref,"],
  ["dispatch", "    commandId: `dispatch:${ref.operationId}`,"],
  ["dispatch", "    expectedVersion: reserved.operation.version,"],
  ["dispatch", '    holder: "api-worker",'],
  ["dispatch", "    leaseTtlMs: 30_000,"],
  ["dispatch", "  });"],
  ["dispatch", '  if ("outcome" in grant || !grant.granted) return grant;'],
  ["dispatch", "  const receipt = await callProvider(input); // The only provider call."],
  [null, ""],
  ["settle", "  const settled = await meter.settle({"],
  ["settle", "    ...ref,"],
  ["settle", "    commandId: `settle:${ref.operationId}`,"],
  ["settle", "    expectedVersion: grant.operation.version,"],
  ["settle", '    authority: { kind: "lease", leaseId: grant.lease.leaseId },'],
  ["settle", "    receipt, // An unknown cost settles as pending and stays reserved."],
  ["settle", "  });"],
  ["settle", '  if (settled.outcome !== "settled") return settled;'],
  [null, ""],
  ["read", "  return loadBudgetsView(meter, access, {"],
  ["read", "    scope: input.scope,"],
  ["read", "    surface: input.surface,"],
  ["read", '    units: ["cents"],'],
  ["read", "    crossings: settled.alerts,"],
  ["read", "  });"],
  [null, "}"],
];
const flowSource = flowLines.map(([, line]) => line).join("\n");

const guarantees = [
  {
    title: "Unknown is not zero.",
    text: "Measured, estimated, unknown and unavailable are different states, and your UI can tell them apart.",
  },
  {
    title: "Every cost has an owner.",
    text: "Provider cost, funding source and customer charge stay distinct, so own keys run alongside platform funding.",
  },
  {
    title: "Your application stays in charge.",
    text: "You own authentication, verified access and billing. Usagekit supplies the metering mechanics.",
  },
] as const;

/** Matches the stacked layout in sections.css, where the steps sit above the code. */
const flowStacked = "(max-width: 1180px)";

/** Brings the lit lines into view, centered below the header, unless they are already visible. */
function revealLitLines() {
  const lines = document.querySelectorAll<HTMLElement>("#flow-code .code-line.is-lit");
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return;
  const top = first.getBoundingClientRect().top;
  const bottom = last.getBoundingClientRect().bottom;
  const header = document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
  const roomTop = header + 16;
  const room = innerHeight - 16 - roomTop;
  if (top >= roomTop && bottom <= roomTop + room) return;
  const height = bottom - top;
  const at = height < room ? roomTop + (room - height) / 2 : roomTop;
  // The page's scroll-behavior applies: smooth, or instant with reduced motion.
  window.scrollTo({ top: window.scrollY + top - at });
}

export function LifecycleSection() {
  const [step, setStep] = useState<Step>("reserve");
  const lit = useMemo(
    () => flowLines.flatMap(([owner], index) => (owner === step ? [index + 1] : [])),
    [step],
  );
  const choose = (id: Step) => {
    setStep(id);
    if (matchMedia(flowStacked).matches) requestAnimationFrame(revealLitLines);
  };
  return (
    <section className="section sec-flow" id="how-it-works" aria-labelledby="flow-title">
      <div className="container">
        <div className="flow-grid">
          <div className="flow-rail">
            <div className="flow-heading">
              <h2 id="flow-title" className="section-title">
                Every paid call follows one lifecycle.
              </h2>
              <p className="section-lede">
                Admit only with headroom, grant exactly one dispatch, settle from evidence. Unknown
                outcomes stay reserved.
              </p>
            </div>
            <ol className="flow-steps">
              {steps.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flow-step"
                    aria-label={item.name}
                    aria-describedby={
                      item.states.length
                        ? `flow-step-${item.id} flow-state-${item.id}`
                        : `flow-step-${item.id}`
                    }
                    aria-current={item.id === step ? "step" : undefined}
                    aria-controls="flow-code"
                    onClick={() => choose(item.id)}
                  >
                    <span className="flow-step-num num" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="flow-step-name">
                      {item.name}
                      {item.states.length ? (
                        <span className="flow-states" id={`flow-state-${item.id}`}>
                          <span className="sr-only">Leaves the operation </span>
                          {item.states.map((state, at) => (
                            <Fragment key={state}>
                              {at ? <span className="sr-only"> or </span> : null}
                              <code className="flow-state">{state}</code>
                            </Fragment>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="flow-step-text" id={`flow-step-${item.id}`}>
                      {item.text}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="flow-code" id="flow-code">
            <Code title="metered-call.ts" highlight={lit}>
              {flowSource}
            </Code>
          </div>
        </div>
        <ul className="flow-guarantees">
          {guarantees.map(({ title, text }) => (
            <li key={title} className="flow-guarantee">
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* Install: published runtime and React packages, with copyable registry blocks. */

export function InstallSection() {
  return (
    <section className="section sec-install" id="install" aria-labelledby="install-title">
      <div className="container">
        <SectionHeading id="install-title" title="Start with the runtime.">
          Embed the Meter in your server, then add views, hooks and copyable blocks when you need
          UI. All seven packages are published at {runtimeVersion}.
        </SectionHeading>
        <div className="install-grid">
          <div className="install-col">
            <div className="install-col-head">
              <h3 className="install-col-title">Install from npm</h3>
              <span className="badge mono">{runtimeVersion}</span>
            </div>
            <Install packages={installPackages} label="Install the runtime" />
            <ul className="install-pkgs">
              {runtimePackages.map(({ name, description }) => (
                <li key={name}>
                  <a className="install-pkg" href={npmPackage(name)}>
                    <span className="install-pkg-name">@usagekit/{name}</span>
                    <span className="install-pkg-desc">{description}</span>
                    <ArrowUpRight {...icon} className="install-pkg-icon" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="install-col install-react">
            <h3 className="install-col-title">Add the React layer</h3>
            <p className="install-text">
              <code className="sec-code">@usagekit/react</code>,{" "}
              <code className="sec-code">@usagekit/views</code> and their runtime dependencies are
              available on npm. Registry blocks request the same {runtimeVersion} cohort and install
              with the shadcn CLI.
            </p>
            <Install packages={reactPackages} label="Install the React layer" />
            <p className="install-text">
              Try every block in each shadcn style and copy a block's install command.{" "}
              <a className="link" href="/examples/">
                Explore the examples
              </a>{" "}
              <a className="link" href="/docs/#checkout">
                Read the installation guide
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Practice: bisibility as the example integration. */

function MeterMark() {
  return (
    <svg className="practice-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M5 6v12a11 11 0 0 0 22 0V6M12 6v12a4 4 0 0 0 8 0V6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
    </svg>
  );
}

export function PracticeSection() {
  return (
    <section className="section sec-practice" id="bisibility" aria-labelledby="practice-title">
      <div className="container practice-grid">
        <div className="practice-copy">
          <h2 id="practice-title" className="section-title">
            Metering real providers in bisibility.
          </h2>
          <p className="section-lede">
            bisibility is an open-source rank tracker with bring-your-own-key search providers. It
            is the example integration for provider usage, own keys and per-surface limits.
          </p>
          <dl className="practice-status">
            <div className="practice-status-row">
              <dt>Metering</dt>
              <dd>
                <span className="practice-dot is-done" aria-hidden="true" />
                Limited rollout
              </dd>
            </div>
            <div className="practice-status-row">
              <dt>React UI</dt>
              <dd>
                <span className="practice-dot" aria-hidden="true" />
                Adoption in progress
              </dd>
            </div>
          </dl>
          <a className="btn btn-outline" href="https://bisibility.com">
            <BisibilityMark size={16} />
            Visit bisibility
            <ArrowUpRight {...icon} />
          </a>
        </div>
        <figure className="practice-diagram">
          <div className="practice-flow">
            <div className="practice-node">
              <span className="practice-node-head">
                <KeyRound {...icon} className="practice-node-icon" />
                <strong className="practice-node-title">Your provider keys</strong>
              </span>
              <span className="practice-node-text">Search providers, funded by your own keys.</span>
            </div>
            <span className="practice-link" aria-hidden="true" />
            <div className="practice-node is-meter">
              <span className="practice-node-head">
                <MeterMark />
                <strong className="practice-node-title">usagekit Meter</strong>
              </span>
              <ul className="practice-rows">
                <li>Usage</li>
                <li>Costs</li>
                <li>Limits</li>
              </ul>
            </div>
            <span className="practice-link" aria-hidden="true" />
            <div className="practice-node">
              <span className="practice-node-head">
                <BisibilityLockup />
              </span>
              <ul className="practice-rows">
                <li>
                  <AppWindow {...icon} />
                  App
                </li>
                <li>
                  <SquareTerminal {...icon} />
                  API
                </li>
              </ul>
            </div>
          </div>
          <figcaption className="practice-caption">
            Selected provider calls are observed during the metering rollout. The app and API keep
            their own limits.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* FAQ */

const pkg = (name: string) => <code className="sec-code">{name}</code>;
const faqs: readonly { question: string; answer: ReactNode }[] = [
  {
    question: "How is this different from usage-based billing?",
    answer:
      "Usage-based billing tools invoice your customers after the fact. Usagekit works before the call: it reserves budget, can block a request without headroom, and records the exact provider cost. It never invoices or sets customer prices, and your app keeps its wallets and credits. Send the ledger to your billing tool if you use one.",
  },
  {
    question: "Do I have to use the React components?",
    answer:
      "No. Use the runtime alone, the pure view models, or only the hooks. The styled blocks are optional.",
  },
  {
    question: "Can I use both BYOK and platform-funded providers?",
    answer:
      "Yes. Every reservation records its funding source and cost owner, so own keys and platform-funded calls stay explicit side by side.",
  },
  {
    question: "What can I install today?",
    answer: (
      <>
        {pkg("@usagekit/core")}, {pkg("store")}, {pkg("meter")}, {pkg("providers")}, {pkg("views")},{" "}
        {pkg("react")} and {pkg("store-postgres")} {runtimeVersion} are on npm. Release{" "}
        {runtimeVersion} adds the {pkg("useProviderEditor")} hook. Copyable blocks in the public
        registry request {runtimeVersion} and install with the shadcn CLI. The local server, SQLite
        and Cloudflare workspaces run from a repository checkout.
      </>
    ),
  },
  {
    question: "Can I customize the styles?",
    answer:
      "Yes. Blocks are copied into your app and use your own primitives. Each shadcn style has its own registry build: New York, or Vega, Nova, Maia, Lyra, Mira, Luma, Sera or Rhea on Radix or Base UI.",
  },
];

export function FaqSection() {
  return (
    <section className="section sec-faq" id="faq" aria-labelledby="faq-title">
      <div className="container">
        <div className="faq-grid">
          <div className="faq-intro">
            <h2 id="faq-title" className="section-title">
              Questions, answered.
            </h2>
            <p className="faq-more">
              The{" "}
              <a className="link" href="/docs/">
                documentation
              </a>{" "}
              covers setup, hooks, blocks and provider management.
            </p>
          </div>
          <div className="faq-list">
            {faqs.map(({ question, answer }) => (
              <details key={question} className="faq-item">
                <summary className="faq-question">
                  <span>{question}</span>
                  <span className="faq-mark" aria-hidden="true" />
                </summary>
                <p className="faq-answer">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* Closing */

export function ClosingSection() {
  return (
    <section className="section sec-close" aria-labelledby="close-title">
      <div className="container">
        <div className="close-inner">
          <h2 id="close-title" className="close-title">
            Make every unit count.
          </h2>
          <div className="close-side">
            <p className="close-lede">
              Reserve before the call, settle from the receipt, and show every user exactly where
              they stand.
            </p>
            <div className="close-actions">
              <a className="btn btn-primary btn-lg" href="/docs/#getting-started">
                Get started
              </a>
              <a className="btn btn-outline btn-lg" href="/docs/">
                Read the docs
              </a>
            </div>
            <Install packages={installPackages} label="Install the runtime" />
          </div>
        </div>
      </div>
    </section>
  );
}
