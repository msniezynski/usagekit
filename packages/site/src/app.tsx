import { useEffect, useRef, useState } from "react";
import { Button } from "@base-ui/react/button";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { BlocksSection } from "./blocks.js";
import { BisibilityMark, Brand } from "./ui.js";
import { npmOrg, runtimeVersion } from "./content.js";
import { Docs } from "./docs.js";
import { Hero } from "./hero.js";
import { LiveMeterProvider } from "./live.js";
import { AgentsSection } from "./agents.js";
import { AgentsClosing, AgentsFaq, AgentsHero } from "./agents-page.js";
import { ComponentsHero } from "./components-page.js";
import { ProductsSection } from "./products.js";
import { StorageSection } from "./storage.js";
import {
  ClosingSection,
  FaqSection,
  HooksSection,
  InstallSection,
  LifecycleSection,
  PracticeSection,
} from "./sections.js";

/** Pages, one per audience: the runtime, components for products, and limits for agents. */
export type Page = "home" | "components" | "agents" | "docs";
const nav = [
  ["/components/", "Components", "components"],
  ["/agents/", "Agents", "agents"],
  ["/#how-it-works", "How it works", null],
  ["/#storage", "Storage", null],
  ["/docs/", "Docs", "docs"],
] as const;

const themeKey = "usagekit-theme";
const isDark = () =>
  document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(isDark()), []);
  const toggle = () => {
    const next = !isDark();
    document.documentElement.dataset.theme = next ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", next ? "#0a0a0a" : "#ffffff");
    setDark(next);
    try {
      localStorage.setItem(themeKey, next ? "dark" : "light");
    } catch {
      // The theme still changes for this visit.
    }
  };
  return (
    <Button
      className="btn btn-ghost btn-icon theme-toggle"
      onClick={toggle}
      aria-label="Dark theme"
      aria-pressed={dark}
    >
      <Moon className="icon-moon" size={16} strokeWidth={1.75} aria-hidden="true" />
      <Sun className="icon-sun" size={16} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  );
}

function Header({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key !== "Escape"
          : header.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
      if (event instanceof KeyboardEvent) toggle.current?.focus();
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  return (
    <header className="site-header" ref={header} data-menu={open ? "open" : "closed"}>
      <div className="container header-inner">
        <Brand />
        <nav className="nav-links" aria-label="Main">
          {nav.map(([href, label, target]) => (
            <a key={href} href={href} aria-current={target === page ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a className="version-link" href={npmOrg}>
            v{runtimeVersion}
            <span className="sr-only"> runtime on npm</span>
          </a>
          <ThemeToggle />
          <a className="btn btn-primary btn-sm header-cta" href="/docs/#getting-started">
            Get started
          </a>
          <Button
            ref={toggle}
            className="btn btn-ghost btn-icon mobile-menu"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? (
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <nav id="mobile-nav" className="mobile-nav" data-open={open} aria-label="Mobile">
        {[...nav, ["/docs/#getting-started", "Get started", null] as const].map(
          ([href, label, target]) => (
            <a
              key={href}
              href={href}
              aria-current={target === page ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          ),
        )}
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <Brand />
          <span>Metering for paid provider calls.</span>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <a href="/components/">Components</a>
          <a href="/agents/">Agents</a>
          <a href="/docs/">Documentation</a>
          <a href={npmOrg}>
            npm packages <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <a href="https://bisibility.com">
            <BisibilityMark size={14} />
            bisibility <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <a href="/LICENSE">Apache-2.0 license</a>
        </nav>
      </div>
      <div className="container">
        <p className="footer-note">
          Runtime {runtimeVersion} is on npm. The React layer runs from the repository checkout.
        </p>
      </div>
    </footer>
  );
}

/** Everyone: what usagekit is, the two ways to use it, and how the runtime works. */
function Home() {
  return (
    <LiveMeterProvider>
      <main id="main">
        <Hero />
        <ProductsSection />
        <LifecycleSection />
        <StorageSection />
        <InstallSection />
        <PracticeSection />
        <FaqSection />
        <ClosingSection />
      </main>
    </LiveMeterProvider>
  );
}

/** Product engineers: usage, cost and budget components and hooks for their own users. */
function Components() {
  return (
    <LiveMeterProvider>
      <main id="main">
        <ComponentsHero />
        <BlocksSection />
        <HooksSection />
        <ClosingSection />
      </main>
    </LiveMeterProvider>
  );
}

/** Agent operators: the local proxy, vault, budgets and dashboard. */
function Agents() {
  return (
    <main id="main">
      <AgentsHero />
      <AgentsSection />
      <AgentsFaq />
      <AgentsClosing />
    </main>
  );
}

const pages: Record<Page, () => React.JSX.Element> = {
  home: Home,
  components: Components,
  agents: Agents,
  docs: Docs,
};

export function App({ page }: { page: Page }) {
  const Content = pages[page];
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header page={page} />
      <Content />
      <Footer />
    </>
  );
}
