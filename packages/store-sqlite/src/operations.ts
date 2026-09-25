import { createHmac, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { Clock } from "@usagekit/store";
import { InvalidInput } from "@usagekit/store";
import type { OperationsPage, OperationsQuery } from "@usagekit/core";
import { canonical } from "./util.js";
import { hydrate } from "./records.js";
import type { OperationRow } from "./records.js";
type Snapshot = {
  query: string;
  watermark: string;
  offset: number;
  asOf: string;
  expiresAt: number;
};
/**
 * Mirrors the usage reader: a signed cursor carries the event watermark of the first page, so
 * membership and order are recomputed exactly at that watermark; rows are hydrated as current.
 */
export function operationsReader(db: Database.Database, clock: Clock, ttl: number) {
  const secret = (
    db.prepare("SELECT value FROM store_metadata WHERE key='cursor_key'").get() as { value: string }
  ).value;
  const sign = (body: string) =>
    createHmac("sha256", secret).update(`operations:${body}`).digest("base64url");
  const open = (cursor: string, identity: string): Snapshot => {
    try {
      const parts = cursor.split(".");
      if (parts.length !== 2) throw new Error();
      const [body, signature] = parts as [string, string],
        actual = Buffer.from(signature),
        expected = Buffer.from(sign(body));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new Error();
      const snapshot = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Snapshot;
      if (snapshot.query !== identity || snapshot.expiresAt <= clock.now().getTime())
        throw new Error();
      return snapshot;
    } catch {
      throw new InvalidInput("cursor", "unknown cursor or query mismatch");
    }
  };
  return (q: OperationsQuery): OperationsPage =>
    db
      .transaction(() => {
        const { cursor, ...query } = q,
          identity = canonical(query);
        const snapshot: Snapshot = cursor
          ? open(cursor, identity)
          : {
              query: identity,
              watermark: String(
                (
                  db
                    .prepare("SELECT COALESCE(MAX(event_id),0) AS n FROM operation_events")
                    .get() as { n: bigint }
                ).n,
              ),
              offset: 0,
              asOf: clock.now().toISOString(),
              expiresAt: clock.now().getTime() + ttl,
            };
        const state =
          "(SELECT e.state FROM operation_events e WHERE e.operation_pk=o.operation_pk AND e.event_id<=? ORDER BY e.event_id DESC LIMIT 1)";
        const clauses = [
            "o.namespace=?",
            "o.created_at>=?",
            "o.created_at<?",
            `${state} IS NOT NULL`,
          ],
          args: (string | bigint | number)[] = [
            q.scope.namespace,
            new Date(q.from).toISOString(),
            new Date(q.to).toISOString(),
            BigInt(snapshot.watermark),
          ];
        if (q.states) {
          clauses.push(`${state} IN (${q.states.map(() => "?").join(",")})`);
          args.push(BigInt(snapshot.watermark), ...q.states);
        }
        if (q.scope.kind === "principal") {
          clauses.push("o.principal=?");
          args.push(q.scope.principal);
        }
        if (q.scope.kind === "group") {
          clauses.push("json_extract(o.operation_json,'$.scope.group')=?");
          args.push(q.scope.group);
        }
        if (q.scope.kind === "platform_pool") {
          clauses.push(
            "EXISTS(SELECT 1 FROM json_each(o.operation_json,'$.platformPools') p WHERE p.value=?)",
          );
          args.push(q.scope.poolId);
        }
        if (q.connection) {
          clauses.push("json_extract(o.operation_json,'$.scope.connection')=?");
          args.push(q.connection);
        }
        const limit = q.limit ?? 1000;
        const rows = db
          .prepare(
            `SELECT o.* FROM operations o WHERE ${clauses.join(" AND ")} ORDER BY o.created_at,o.operation_id LIMIT ? OFFSET ?`,
          )
          .all(...args, limit + 1, snapshot.offset) as OperationRow[];
        const page: OperationsPage = {
          operations: rows.slice(0, limit).map((row) => hydrate(db, row)),
          asOf: snapshot.asOf,
          watermark: snapshot.watermark,
        };
        if (rows.length > limit) {
          const body = Buffer.from(
            JSON.stringify({ ...snapshot, offset: snapshot.offset + limit }),
          ).toString("base64url");
          page.nextCursor = body + "." + sign(body);
        }
        return page;
      })
      .deferred();
}
