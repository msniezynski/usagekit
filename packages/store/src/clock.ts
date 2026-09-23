export interface Clock {
  now(): Date;
}
export interface ManualClock extends Clock {
  advance(ms: number): void;
  set(date: string | Date): void;
}
export function createManualClock(initial = "2026-09-23T12:00:00.000Z"): ManualClock {
  let time = new Date(initial).getTime();
  return {
    now: () => new Date(time),
    advance: (ms) => {
      time += ms;
    },
    set: (date) => {
      time = new Date(date).getTime();
    },
  };
}
