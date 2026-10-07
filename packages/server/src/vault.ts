import { existsSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { writePrivate } from "./config.js";
/** tags are connection labels the CLI snapshots into each reservation scope; never secret. */
export type ConnectionMetadata = {
  label?: string;
  plan?: string;
  manualPrices?: Readonly<Record<string, { unit: string; value: string; scale: number }>>;
  overage?: boolean;
  tracking?: Readonly<Record<string, "metered" | "passthrough">>;
};
type Listed = ConnectionMetadata & {
  provider: string;
  connectionId: string;
  tags?: readonly string[];
};
type Entry = Listed & { secret: string; revision: string };
type Envelope = {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  index: (Listed & { revision?: string })[];
};
const listed = ({
  provider,
  connectionId,
  label,
  tags,
  plan,
  tracking,
  manualPrices,
  overage,
}: Entry): Listed => ({
  ...(label ? { label } : {}),
  ...(plan ? { plan } : {}),
  ...(tracking ? { tracking } : {}),
  ...(manualPrices ? { manualPrices } : {}),
  ...(overage === undefined ? {} : { overage }),
  provider,
  connectionId,
  ...(tags ? { tags } : {}),
});
export function createVault(path: string) {
  let key: Buffer | null = null,
    salt: Buffer | null = null,
    entries: Entry[] = [];
  const read = (): Envelope | null =>
    existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Envelope) : null;
  const requireKey = () => {
    if (!key) throw new Error("VaultLocked");
    return key;
  };
  const save = (next = entries) => {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", requireKey(), iv),
      ciphertext = Buffer.concat([cipher.update(JSON.stringify(next), "utf8"), cipher.final()]);
    const envelope: Envelope = {
      version: 1,
      salt: salt!.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      index: next.map((entry) => ({ ...listed(entry), revision: entry.revision })),
    };
    writePrivate(path, JSON.stringify(envelope));
    entries = next;
  };
  return {
    get unlocked() {
      return key !== null;
    },
    unlock(passphrase: string) {
      if (!passphrase) throw new Error("VaultUnlockFailed");
      try {
        const stored = read(),
          nextSalt = stored ? Buffer.from(stored.salt, "base64") : randomBytes(16),
          candidate = scryptSync(passphrase, nextSalt, 32);
        let decoded: Entry[] = [];
        if (stored) {
          if (stored.version !== 1) throw new Error("version");
          const decipher = createDecipheriv(
            "aes-256-gcm",
            candidate,
            Buffer.from(stored.iv, "base64"),
          );
          decipher.setAuthTag(Buffer.from(stored.tag, "base64"));
          decoded = JSON.parse(
            Buffer.concat([
              decipher.update(Buffer.from(stored.ciphertext, "base64")),
              decipher.final(),
            ]).toString("utf8"),
          );
        }
        key = candidate;
        salt = nextSalt;
        entries = decoded.map((entry) => ({ ...entry, revision: entry.revision ?? randomUUID() }));
        if (!stored || decoded.some((entry) => !entry.revision)) save();
      } catch {
        throw new Error("VaultUnlockFailed");
      }
    },
    put(
      provider: string,
      connectionId: string,
      secret: string,
      tags?: readonly string[],
      metadata: ConnectionMetadata = {},
    ) {
      requireKey();
      if (!provider.trim() || !connectionId.trim() || !secret.trim())
        throw new Error("InvalidConnection");
      if (entries.some((e) => e.connectionId === connectionId && e.provider !== provider))
        throw new Error("ConnectionProviderMismatch");
      const next = [
        ...entries.filter((e) => e.connectionId !== connectionId),
        {
          ...entries.find((e) => e.connectionId === connectionId),
          provider,
          connectionId,
          secret,
          revision: randomUUID(),
          ...(tags ? { tags } : {}),
          ...metadata,
        },
      ];
      save(next);
    },
    get(provider: string, connectionId: string) {
      requireKey();
      const entry = entries.find((e) => e.connectionId === connectionId && e.provider === provider);
      if (!entry) throw new Error("ConnectionNotFound");
      return entry.secret;
    },
    list(): Listed[] {
      return key
        ? entries.map(listed)
        : (read()?.index ?? []).map(({ revision: _revision, ...entry }) => entry);
    },
    describe(): (Listed & { revision?: string })[] {
      return key
        ? entries.map((entry) => ({ ...listed(entry), revision: entry.revision }))
        : (read()?.index ?? []);
    },
    update(connectionId: string, metadata: ConnectionMetadata) {
      requireKey();
      if (!entries.some((entry) => entry.connectionId === connectionId))
        throw new Error("ConnectionNotFound");
      save(
        entries.map((entry) =>
          entry.connectionId === connectionId
            ? { ...entry, ...metadata, revision: randomUUID() }
            : entry,
        ),
      );
    },
    remove(connectionId: string) {
      requireKey();
      save(entries.filter((e) => e.connectionId !== connectionId));
    },
    lock() {
      key?.fill(0);
      key = null;
      entries = [];
    },
  };
}
export type Vault = ReturnType<typeof createVault>;
