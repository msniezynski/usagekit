import { useEffect, useRef, useState } from "react";
import { usdExact } from "./format.js";
import type { Live } from "./live.js";
import type { SiteEvent } from "./meter-fixture.js";

/** One sentence for a sample command's latest state, with exact amounts. */
export function outcomeText(event: SiteEvent): string {
  const actual = event.actual === null ? "an unknown amount" : usdExact(event.actual);
  switch (event.status) {
    case "reserved":
      return `Reserved ${usdExact(event.estimate)} before dispatch. Waiting for the receipt.`;
    case "settled":
      return `Settled ${actual} from the receipt.`;
    case "pending":
      return `No cost on the receipt, so ${usdExact(event.estimate)} stays reserved.`;
    case "evidence":
      return `Late evidence settled ${actual}.`;
    case "blocked":
      return "Blocked before dispatch. No provider call was made.";
  }
}

/**
 * Announces what a control's own commands did, one sentence per step. A command claims the
 * first new event after it, so requests sent from elsewhere on the page stay silent here.
 */
export function useAnnouncer(live: Live) {
  const claims = useRef(0);
  /** Operations this control started, with the last status it announced. */
  const own = useRef(new Map<string, SiteEvent["status"] | null>());
  const seen = useRef(new Set<string>());
  const [said, setSaid] = useState({ text: "", count: 0 });
  const say = (text: string) => setSaid((last) => ({ text, count: last.count + 1 }));
  useEffect(() => {
    if (!live.ready) {
      // A reset starts a new Meter, and its operation ids start over.
      claims.current = 0;
      own.current.clear();
      seen.current.clear();
      return;
    }
    let text: string | null = null;
    // Oldest first, so each command claims the event it created.
    for (const event of [...live.events].reverse()) {
      if (!seen.current.has(event.id)) {
        seen.current.add(event.id);
        if (claims.current > 0) {
          claims.current--;
          own.current.set(event.id, null);
        }
      }
      if (own.current.has(event.id) && own.current.get(event.id) !== event.status) {
        own.current.set(event.id, event.status);
        text = outcomeText(event);
      }
    }
    if (text !== null) say(text);
  }, [live.ready, live.events]);
  useEffect(() => {
    if (live.problem) say(live.problem);
  }, [live.problem]);
  return {
    said,
    say,
    /** Call before a command that creates an event: send or simulate a timeout. */
    claim: () => {
      claims.current++;
    },
    /** Call before settling a pending operation, so its evidence is announced too. */
    adopt: (id: string) => {
      if (!own.current.has(id)) own.current.set(id, "pending");
    },
  };
}
