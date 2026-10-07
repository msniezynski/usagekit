import { createHash, randomUUID } from "node:crypto";
import type { SqliteStore } from "@usagekit/store-sqlite";
import type { ProviderActionResult, ProviderCommand } from "@usagekit/views";
import { canonical } from "./input.js";

type Row = { command_hash: string; target: string | null; result: string | null };
export function createCommandJournal(store: SqliteStore) {
  const db = store.database;
  db.exec(`CREATE TABLE IF NOT EXISTS local_provider_identity (id INTEGER PRIMARY KEY CHECK(id = 1), instance_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_provider_commands (command_id TEXT PRIMARY KEY, command_hash TEXT NOT NULL,
      target TEXT, result TEXT);
    CREATE TRIGGER IF NOT EXISTS local_provider_command_immutable BEFORE UPDATE ON local_provider_commands
      WHEN OLD.result IS NOT NULL OR OLD.command_hash != NEW.command_hash OR OLD.command_id != NEW.command_id OR OLD.target IS NOT NEW.target
      BEGIN SELECT RAISE(ABORT, 'immutable command'); END;
    CREATE TRIGGER IF NOT EXISTS local_provider_command_retained BEFORE DELETE ON local_provider_commands
      BEGIN SELECT RAISE(ABORT, 'retained command'); END;`);
  db.prepare("INSERT OR IGNORE INTO local_provider_identity VALUES (1, ?)").run(randomUUID());
  const instance = (
    db.prepare("SELECT instance_id FROM local_provider_identity WHERE id = 1").get() as {
      instance_id: string;
    }
  ).instance_id;
  return {
    scopeKey: `usagekit-local:${instance}`,
    pending: () => !!db.prepare("SELECT 1 FROM local_provider_commands WHERE result IS NULL").get(),
    hash: (command: ProviderCommand) =>
      createHash("sha256").update(canonical(command)).digest("hex"),
    find(commandId: string): Row | undefined {
      return db
        .prepare(
          "SELECT command_hash, target, result FROM local_provider_commands WHERE command_id = ?",
        )
        .get(commandId) as Row | undefined;
    },
    begin(command: ProviderCommand, hash: string, target: string | null): boolean {
      return db
        .transaction(() => {
          if (db.prepare("SELECT 1 FROM local_provider_commands WHERE result IS NULL").get())
            return false;
          db.prepare("INSERT INTO local_provider_commands VALUES (?, ?, ?, NULL)").run(
            command.commandId,
            hash,
            target,
          );
          return true;
        })
        .immediate();
    },
    complete(commandId: string, result: ProviderActionResult) {
      db.prepare(
        "UPDATE local_provider_commands SET result = ? WHERE command_id = ? AND result IS NULL",
      ).run(JSON.stringify(result), commandId);
    },
    decode: (row: Row): ProviderActionResult | null =>
      row.result === null ? null : (JSON.parse(row.result) as ProviderActionResult),
  };
}
