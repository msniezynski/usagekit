import { beforeEach, afterEach, describe, expect, test } from "vitest";
import type { StoreFactory, StoreFixture } from "./factory.js";
import { input, budget, quantity } from "./helpers.js";
export function tagTests(factory: StoreFactory) {
  describe("connection tags", () => {
    let f: StoreFixture;
    beforeEach(async () => {
      f = await factory();
    });
    afterEach(async () => f.close());
    const tagged = (tags: readonly string[] | undefined, principal = "u1") =>
      input({
        scope: {
          namespace: "test",
          principal,
          connection: `c_${principal}`,
          ...(tags ? { tags } : {}),
        },
      });
    const prod = { kind: "tag", namespace: "test", tag: "prod" } as const;
    test("a tag budget spans principals and blocks the call that exhausts it", async () => {
      const b = budget({ scope: prod, limit: quantity(2n) });
      f.budgets.push(b);
      expect(await f.store.reserve(tagged(["prod"], "u1"))).toMatchObject({ outcome: "reserved" });
      expect(await f.store.reserve(tagged(["eu", "prod"], "u2"))).toMatchObject({
        outcome: "reserved",
        operation: { budgetEpochs: [{ budgetId: b.id }] },
      });
      expect(await f.store.reserve(tagged(["prod"], "u3"))).toMatchObject({
        outcome: "exceeded",
        exceeded: { budget: { id: b.id } },
      });
    });
    test("operations without the tag are not bounded by tag budgets", async () => {
      f.budgets.push(budget({ scope: prod, limit: quantity(0n) }));
      expect(await f.store.reserve(tagged(undefined))).toMatchObject({
        outcome: "reserved",
        operation: { budgetEpochs: [] },
      });
      expect(await f.store.reserve(tagged(["staging"]))).toMatchObject({
        outcome: "reserved",
        operation: { budgetEpochs: [] },
      });
      expect(await f.store.reserve(tagged(["prod"]))).toMatchObject({ outcome: "exceeded" });
    });
    test("tag budgets sort after group and before connection in the default order", async () => {
      const tag = budget({ scope: prod, limit: quantity(0n) }),
        connection = budget({
          scope: { kind: "connection", namespace: "test", connection: "c_u1" },
          limit: quantity(0n),
        }),
        group = budget({
          scope: { kind: "group", namespace: "test", group: "g1" },
          limit: quantity(0n),
        });
      f.budgets.push(connection, tag);
      expect(await f.store.reserve(tagged(["prod"]))).toMatchObject({
        exceeded: { budget: { id: tag.id } },
      });
      f.budgets.push(group);
      const i = tagged(["prod"]);
      i.scope.group = "g1";
      expect(await f.store.reserve(i)).toMatchObject({ exceeded: { budget: { id: group.id } } });
    });
    test.each([
      { name: "empty list", tags: [] },
      { name: "empty tag", tags: [""] },
      { name: "upper case", tags: ["Prod"] },
      { name: "leading punctuation", tags: ["-prod"] },
      { name: "whitespace", tags: ["pro d"] },
      { name: "duplicate", tags: ["prod", "prod"] },
      { name: "too long", tags: ["a".repeat(65)] },
      { name: "too many", tags: Array.from({ length: 17 }, (_, n) => `t${n}`) },
    ])("invalid tags are a validation failure: $name", async ({ tags }) => {
      await expect(f.store.reserve(tagged(tags))).rejects.toThrow("InvalidInput");
    });
    test("tags are stored sorted and unique up to the limits", async () => {
      const tags = ["z9", "a", "team-x", "eu:west", "v1.2", "under_score"];
      const r = await f.store.reserve(tagged(tags));
      expect(r).toMatchObject({
        outcome: "reserved",
        operation: { scope: { tags: [...tags].sort() } },
      });
      const sixteen = Array.from({ length: 16 }, (_, n) => `t${String(n).padStart(2, "0")}`);
      expect(await f.store.reserve(tagged(sixteen))).toMatchObject({ outcome: "reserved" });
      expect(await f.store.reserve(tagged(["a".repeat(64)]))).toMatchObject({
        outcome: "reserved",
      });
    });
    test("tags are attribution: replay with other tags keeps the first reservation's tags", async () => {
      const i = tagged(["b", "a"]);
      const first = await f.store.reserve(i);
      if (first.outcome !== "reserved") throw new Error("fixture");
      expect(first.operation.scope.tags).toEqual(["a", "b"]);
      const replay = await f.store.reserve({ ...i, scope: { ...i.scope, tags: ["c"] } });
      expect(replay).toEqual({ ...first, replayed: true });
      const { tags: _, ...untagged } = i.scope;
      expect(await f.store.reserve({ ...i, scope: untagged })).toEqual({
        ...first,
        replayed: true,
      });
    });
  });
}
