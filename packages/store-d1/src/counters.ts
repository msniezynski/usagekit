import type { Database } from "./database.js";
import type { Clock, CountBucket, Store } from "@usagekit/store";
import {
  bucketOf,
  countIdentity,
  countRows,
  validateCountRequest,
  validateRequestCountsQuery,
} from "@usagekit/store";
import { hash } from "./util.js";

type Row = Omit<CountBucket, "pools" | "group"> & { grp: string; pools_json: string };

/**
 * Request counter: one upsert per call into daily buckets and a replay row per command, in
 * one immediate transaction. Reads filter by namespace and day in SQL, the rest in memory
 * with the reference grouping, so both adapters order and truncate identically.
 */
export function counters(
  db: Database,
  clock: Clock,
): Pick<Store, "countRequest" | "requestCounts"> {
  const replay = db.prepare(
      "SELECT identity_hash FROM request_commands WHERE namespace=? AND command_id=?",
    ),
    remember = db.prepare("INSERT INTO request_commands VALUES(?,?,?)"),
    upsert = db.prepare(
      `INSERT INTO request_counts VALUES(?,?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(namespace,principal,grp,connection,pools_json,day,provider,operation,state,source)
       DO UPDATE SET count=count+1`,
    ),
    window = db.prepare("SELECT * FROM request_counts WHERE namespace=? AND day>=? AND day<?");
  return {
    countRequest: async (i) => {
      validateCountRequest(i);
      const identity = hash(countIdentity(i));
      return db
        .transaction(() => {
          const previous = replay.get(i.scope.namespace, i.commandId) as
            | { identity_hash: string }
            | undefined;
          if (previous)
            return previous.identity_hash === identity
              ? ({ outcome: "counted", replayed: true } as const)
              : ({ outcome: "conflict", reason: "command_mismatch" } as const);
          if (
            db
              .prepare("SELECT 1 FROM operations WHERE namespace=? AND operation_id=?")
              .get(i.scope.namespace, i.commandId)
          )
            return { outcome: "conflict", reason: "command_mismatch" } as const;
          const b = bucketOf(i, clock.now());
          upsert.run(
            b.namespace,
            b.principal,
            b.group,
            b.connection,
            JSON.stringify(b.pools),
            b.day,
            b.provider,
            b.operation,
            b.state,
            b.source,
          );
          remember.run(i.scope.namespace, i.commandId, identity);
          return { outcome: "counted", replayed: false } as const;
        })
        .immediate();
    },
    requestCounts: async (q) => {
      validateRequestCountsQuery(q);
      return db
        .transaction(() => {
          const day = (t: string) => new Date(t).toISOString().slice(0, 10),
            rows = window.all(q.scope.namespace, day(q.from), day(q.to)) as Row[];
          return countRows(
            rows.map(({ grp, pools_json, count, ...rest }) => ({
              ...rest,
              group: grp,
              pools: JSON.parse(pools_json) as string[],
              count: BigInt(count),
            })),
            q,
            clock.now().toISOString(),
          );
        })
        .deferred();
    },
  };
}
