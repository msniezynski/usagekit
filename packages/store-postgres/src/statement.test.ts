import { expect, test } from "vitest";
import { SQL, schemaIdentifier } from "./statement.js";

test("nested fragments bind hostile values without rewriting literal dollar placeholders", () => {
  const hostile = "x'); DROP TABLE metering_operation; --";
  const fragment = SQL.sql`principal=${hostile} AND n IN (${SQL.join([1, 2])})`;
  expect(
    SQL.sql`SELECT '$1' AS literal WHERE ${fragment} AND namespace=${"tenant"}`.compile(),
  ).toEqual({
    text: "SELECT '$1' AS literal WHERE principal=$1 AND n IN ($2,$3) AND namespace=$4",
    values: [hostile, 1, 2, "tenant"],
  });
});
test.each(["public;DROP SCHEMA public", 'x"', "a".repeat(64), "pg_temp.x", ""])(
  "rejects an unsafe or truncated schema identifier: %s",
  (value) => {
    expect(() => schemaIdentifier(value)).toThrow("Invalid metering schema");
  },
);
