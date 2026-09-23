import { expect, test } from "vitest";
import Database from "better-sqlite3";
test("native binding preserves signed 64-bit integers", () => {
  const db = new Database(":memory:");
  try {
    db.defaultSafeIntegers();
    expect(db.prepare("SELECT ? AS amount").get(2n ** 63n - 1n)).toEqual({
      amount: 2n ** 63n - 1n,
    });
  } finally {
    db.close();
  }
});
