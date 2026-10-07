import type { ReactNode } from "react";

/* The agents page around AgentsSection: its header (the only h1), questions and closing. */

/** Inline code in running text. */
const C = ({ children }: { children: ReactNode }) => <code className="agp-code">{children}</code>;

export function AgentsHero() {
  return (
    <section className="agp-hero" aria-labelledby="agp-title">
      <div className="container agp-hero-inner">
        <h1 id="agp-title" className="agp-title">
          Spend limits for the APIs your agents call.
        </h1>
        <div className="agp-side">
          <p className="agp-lede">
            <C>usagekit serve</C> runs a local API proxy, ledger and usage dashboard. Give an agent
            a local token instead of your provider key. Metered calls reserve budget before
            dispatch; a blocking budget answers 429 when there is no headroom.
          </p>
          <div className="agp-actions">
            <a className="btn btn-primary" href="/docs/#local-server">
              Set it up
            </a>
            <a className="btn btn-outline" href="#agents">
              How it works
            </a>
          </div>
        </div>
        <Terminal />
      </div>
    </section>
  );
}

/**
 * The first start, as the server prints it: the bearer token once, then the loopback address.
 * Interactive vault prompts are left out, and the token is masked.
 */
function Terminal() {
  return (
    <figure className="agp-term">
      <figcaption className="agp-term-bar">
        <span className="agp-term-title">Terminal</span>
        <span className="agp-term-label">Illustration</span>
      </figcaption>
      <pre className="agp-term-body">
        <code>
          <span className="agp-line is-note"># In the repository checkout</span>
          <span className="agp-line is-command">
            <span className="agp-prompt" aria-hidden="true">
              {"$ "}
            </span>
            usagekit serve
          </span>
          <span className="agp-line">
            usagekit token (shown once):{" "}
            <span className="agp-secret" aria-hidden="true">
              ••••••••••••
            </span>
            <span className="sr-only">hidden</span>
          </span>
          <span className="agp-line">
            usagekit listening on <span className="agp-url">http://127.0.0.1:4242</span>
          </span>
        </code>
      </pre>
    </figure>
  );
}

/* Questions */

const faqs: readonly { question: string; answer: ReactNode }[] = [
  {
    question: "Which APIs work?",
    answer:
      "DataForSEO and SerpApi, through bundled provider descriptors. Any other provider needs a descriptor first.",
  },
  {
    question: "Does it stop calls that skip the proxy?",
    answer: "No. Only calls sent through the proxy are metered and enforced.",
  },
  {
    question: "Is it hosted?",
    answer:
      "No. It is a single-owner server on loopback, 127.0.0.1 by default. Provider keys stay in an encrypted vault on your machine.",
  },
  {
    question: "Can it cap money exactly?",
    answer:
      "Request limits are exact. Money limits use price estimates, so a provider that bills more can go over, and the overrun stays in the ledger.",
  },
  {
    question: "What happens after a crash?",
    answer:
      "Calls already sent stay pending with unknown cost and are never resent. You find them under Exceptions in the dashboard.",
  },
  {
    question: "Is it on npm?",
    answer: (
      <>
        No. The server, proxy and CLI run from the repository checkout.{" "}
        <a className="link" href="/docs/#local-server">
          Set up the checkout
        </a>
      </>
    ),
  },
];

export function AgentsFaq() {
  return (
    <section className="section agp-faq" id="agents-faq" aria-labelledby="agp-faq-title">
      <div className="container agp-faq-grid">
        <div className="agp-faq-intro">
          <h2 id="agp-faq-title" className="section-title">
            Questions, answered.
          </h2>
          <p className="agp-faq-more">The guides in the repository cover the rest.</p>
          <p className="agp-faq-docs">
            <C>docs/LOCAL-SERVER.md</C> <C>docs/PROXY.md</C>
          </p>
        </div>
        <div className="agp-faq-list">
          {faqs.map(({ question, answer }) => (
            <details key={question} className="agp-faq-item">
              <summary className="agp-faq-question">
                <span>{question}</span>
                <span className="agp-faq-mark" aria-hidden="true" />
              </summary>
              <p className="agp-faq-answer">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Closing */

export function AgentsClosing() {
  return (
    <section className="section agp-close" aria-labelledby="agp-close-title">
      <div className="container">
        <div className="agp-close-inner">
          <h2 id="agp-close-title" className="agp-close-title">
            Give your agents a&nbsp;budget.
          </h2>
          <div className="agp-close-side">
            <p className="agp-close-lede">
              One local server to meter, monitor and limit your agents' API calls.
            </p>
            <div className="agp-actions">
              <a className="btn btn-primary btn-lg" href="/docs/#local-server">
                Set it up
              </a>
              <a className="btn btn-outline btn-lg" href="/docs/">
                Read the docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
