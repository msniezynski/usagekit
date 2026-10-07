import type { PostgresDriver, PostgresExecutor } from "./driver.js";
import { SQL, schemaIdentifier, type Statement } from "./statement.js";

export type Counters = { statements: number; changes: bigint; rowsRead: number };
export type Sql = ReturnType<typeof createSql>;
export function createSql(executor: PostgresExecutor, counters: Counters) {
  return {
    async query<T>(query: Statement): Promise<T[]> {
      counters.statements++;
      const result = await executor.query<T>(query.compile());
      counters.rowsRead += result.length;
      return result;
    },
    async execute(query: Statement): Promise<number> {
      counters.statements++;
      const count = await executor.execute(query.compile());
      counters.changes += BigInt(count);
      return count;
    },
  };
}
export function transactions(driver: PostgresDriver, schema: string, counters: Counters) {
  const identifier = schemaIdentifier(schema);
  const run = <T>(readOnly: boolean, body: (sql: Sql) => Promise<T>) =>
    driver.transaction(readOnly, async (executor) => {
      const sql = createSql(executor, counters);
      await sql.query(SQL.sql`SELECT set_config('search_path', ${identifier}, true)`);
      return body(sql);
    });
  return {
    read: <T>(body: (sql: Sql) => Promise<T>) => run(true, body),
    write: <T>(body: (sql: Sql) => Promise<T>) => run(false, body),
  };
}
export async function lock(sql: Sql, value: string, tryOnly = false): Promise<boolean> {
  if (tryOnly) {
    const [row] = await sql.query<{ acquired: boolean }>(
      SQL.sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${value},0)) AS acquired`,
    );
    return row?.acquired === true;
  }
  await sql.query(
    SQL.sql`SELECT 1 AS acquired FROM pg_advisory_xact_lock(hashtextextended(${value},0))`,
  );
  return true;
}
export { SQL };
