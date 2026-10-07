import type { Pool, PoolClient } from "pg";
import type { ParameterizedQuery } from "./statement.js";

/** Values are bound separately from text by every driver implementation. */
export interface PostgresExecutor {
  query<T>(query: ParameterizedQuery): Promise<T[]>;
  execute(query: ParameterizedQuery): Promise<number>;
}
export interface PostgresDriver {
  transaction<T>(readOnly: boolean, body: (sql: PostgresExecutor) => Promise<T>): Promise<T>;
}
export function nodePostgresExecutor(client: PoolClient): PostgresExecutor {
  return {
    async query<T>({ text, values }: ParameterizedQuery) {
      return (await client.query(text, values)).rows as T[];
    },
    async execute({ text, values }) {
      return (await client.query(text, values)).rowCount ?? 0;
    },
  };
}
/** One checked-out connection owns BEGIN, every statement, COMMIT and ROLLBACK. */
export function createNodePostgresDriver(pool: Pool): PostgresDriver {
  return {
    async transaction(readOnly, body) {
      const client = await pool.connect();
      let destroy = false;
      try {
        await client.query(
          readOnly
            ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
            : "BEGIN ISOLATION LEVEL READ COMMITTED",
        );
        await client.query("SET LOCAL statement_timeout = '30s'");
        await client.query("SET LOCAL lock_timeout = '10s'");
        const result = await body(nodePostgresExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          destroy = true;
        }
        throw error;
      } finally {
        client.release(destroy);
      }
    },
  };
}

export interface PrismaPostgresTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}
export interface PrismaPostgresClient {
  $transaction<T>(
    body: (transaction: PrismaPostgresTransaction) => Promise<T>,
    options: {
      timeout: number;
      maxWait: number;
      isolationLevel: "RepeatableRead" | "ReadCommitted";
    },
  ): Promise<T>;
}
/** The Unsafe-named Prisma methods still bind every value as a positional parameter. */
export function prismaPostgresExecutor(transaction: PrismaPostgresTransaction): PostgresExecutor {
  // Prisma's pg adapter encodes Date without an offset. Preserve the UTC instant for timestamptz
  // even when a host connection uses a non-UTC TimeZone, including caller-owned transactions.
  const parameters = (values: unknown[]) =>
    values.map((value) => (value instanceof Date ? value.toISOString() : value));
  return {
    query: <T>({ text, values }: ParameterizedQuery) =>
      transaction.$queryRawUnsafe<T[]>(text, ...parameters(values)),
    execute: ({ text, values }) => transaction.$executeRawUnsafe(text, ...parameters(values)),
  };
}
export function createPrismaPostgresDriver(prisma: PrismaPostgresClient): PostgresDriver {
  return {
    transaction: (readOnly, body) =>
      prisma.$transaction(
        async (transaction) => {
          if (readOnly) await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          return body(prismaPostgresExecutor(transaction));
        },
        {
          timeout: 30000,
          maxWait: 10000,
          isolationLevel: readOnly ? "RepeatableRead" : "ReadCommitted",
        },
      ),
  };
}
