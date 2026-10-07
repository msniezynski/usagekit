import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@base-ui/react/button";
import { Tabs } from "@base-ui/react/tabs";
import { tokenLines } from "./highlight.js";
import type { Lang } from "./highlight.js";

/** Copies text and reports the result to assistive technology. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };
  return (
    <>
      <Button
        className={className ? `copy-button ${className}` : "copy-button"}
        onClick={copy}
        aria-label={`Copy ${label}`}
        data-state={state}
      >
        {state === "copied" ? (
          <Check size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        )}
      </Button>
      <span className="sr-only" role="status">
        {state === "copied"
          ? `${label} copied to the clipboard`
          : state === "failed"
            ? "Copy unavailable. Select the text to copy it manually."
            : ""}
      </span>
    </>
  );
}

/** A highlighted, copyable code sample. highlight lists 1-based lines to emphasize. */
export function Code({
  children,
  title,
  lang = "tsx",
  highlight,
  className,
}: {
  children: string;
  title: string;
  lang?: Lang;
  highlight?: readonly number[];
  className?: string;
}) {
  const lines = tokenLines(children, lang);
  const lit = highlight && highlight.length ? new Set(highlight) : null;
  return (
    <figure className={className ? `code ${className}` : "code"} data-lang={lang}>
      <figcaption className="code-head">
        <span className="code-title">{title}</span>
        <CopyButton text={children} label={`${title} code`} />
      </figcaption>
      <pre className="code-body" tabIndex={0} role="region" aria-label={`${title} code`}>
        <code>
          {lines.map((line, index) => (
            <span
              key={index}
              className={
                lit ? (lit.has(index + 1) ? "code-line is-lit" : "code-line is-dim") : "code-line"
              }
            >
              {line.map((token, at) =>
                token.kind ? (
                  <span key={at} className={`tok-${token.kind}`}>
                    {token.text}
                  </span>
                ) : (
                  token.text
                ),
              )}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

const managers = ["npm", "pnpm", "yarn", "bun"] as const;
type Manager = (typeof managers)[number];
const verb: Record<Manager, string> = {
  npm: "npm install",
  pnpm: "pnpm add",
  yarn: "yarn add",
  bun: "bun add",
};
const storageKey = "usagekit-package-manager";
const managerEvent = "usagekit-package-manager";

/** Package manager tabs over one install command. The choice is remembered per browser. */
export function Install({
  packages,
  label = "Install",
}: {
  packages: readonly string[];
  label?: string;
}) {
  const [manager, setManager] = useState<Manager>("npm");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (managers.includes(saved as Manager)) setManager(saved as Manager);
    } catch {
      // Storage can be unavailable; npm stays selected.
    }
    // Every install box on the page follows the latest choice.
    const follow = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (managers.includes(value as Manager)) setManager(value as Manager);
    };
    window.addEventListener(managerEvent, follow);
    return () => window.removeEventListener(managerEvent, follow);
  }, []);
  const choose = (value: unknown) => {
    if (!managers.includes(value as Manager)) return;
    window.dispatchEvent(new CustomEvent(managerEvent, { detail: value }));
    try {
      localStorage.setItem(storageKey, value as Manager);
    } catch {
      // The choice simply is not remembered.
    }
  };
  return (
    <Tabs.Root className="install" value={manager} onValueChange={choose}>
      <div className="install-head">
        <Tabs.List className="install-tabs" aria-label={`${label} with`}>
          {managers.map((name) => (
            <Tabs.Tab key={name} value={name} className="install-tab">
              {name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <CopyButton text={`${verb[manager]} ${packages.join(" ")}`} label={`${manager} command`} />
      </div>
      {managers.map((name) => (
        <Tabs.Panel key={name} value={name} className="install-panel">
          <pre className="install-command">
            <code>
              <span className="tok-fn">{verb[name].split(" ")[0]}</span>{" "}
              {verb[name].split(" ").slice(1).join(" ")} {packages.join(" ")}
            </code>
          </pre>
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
