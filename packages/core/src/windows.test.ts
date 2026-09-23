import { expect, test } from "vitest";
import { resolveWindow } from "./windows.js";
test.each(["2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"])("calendar UTC %s", (now) => {
  expect(resolveWindow({ kind: "calendar_month", timezone: "UTC" }, new Date(now))).toEqual({
    epoch: "2026-09",
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-10-01T00:00:00.000Z",
  });
});
test("provider interval is start-inclusive and end-exclusive", () => {
  const w = {
    kind: "provider_cycle" as const,
    cycleId: "p",
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: "2026-09-23T00:00:00.000Z",
  };
  expect(resolveWindow(w, new Date(w.startsAt)).epoch).toBe("p");
  expect(() => resolveWindow(w, new Date(w.endsAt))).toThrow("InactiveWindow");
});
test("since-reset keeps explicit epoch and unbounded end", () => {
  expect(
    resolveWindow(
      { kind: "since_reset", epoch: "e2", startsAt: "2026-09-01T00:00:00.000Z" },
      new Date("2026-09-23"),
    ),
  ).toEqual({ epoch: "e2", startsAt: "2026-09-01T00:00:00.000Z", endsAt: null });
});
test("rolling fails explicitly; invalid dates and inactive windows fail closed", () => {
  expect(() => resolveWindow({ kind: "rolling", days: 3 }, new Date())).toThrow(
    "UnsupportedWindow",
  );
  expect(() =>
    resolveWindow({ kind: "calendar_month", timezone: "UTC" }, new Date("invalid")),
  ).toThrow();
  expect(() =>
    resolveWindow(
      { kind: "since_reset", epoch: "future", startsAt: "2027-01-01T00:00:00Z" },
      new Date("2026-01-01"),
    ),
  ).toThrow("InactiveWindow");
});
