import { expect, test } from "vitest";
import { Linter } from "eslint";
import plugin from "./eslint.js";
const linter = new Linter({ cwd: "/fixture" });
const config: Linter.Config[] = [
  {
    files: ["**/*.js"],
    plugins: { usagekit: plugin },
    rules: {
      "usagekit/no-direct-provider-call": [
        "error",
        { modules: ["provider-sdk", "@vendor/**"], wrappers: ["src/metering/*.js"] },
      ],
    },
  },
];
test("fixture project imports only provider clients from approved wrappers", () => {
  const files = {
    "src/metering/wrapper.js": 'import client from "provider-sdk"; export default client;',
    "src/page.js": 'import client from "provider-sdk";',
    "src/lazy.js": 'const client = import("@vendor/search");',
    "src/legacy.js": 'const client = require("provider-sdk");',
    "src/barrel.js": 'export { search } from "provider-sdk"; export * from "@vendor/search";',
    "src/app.js": 'import wrapper from "./metering/wrapper.js";',
    "src/metering/nested/bypass.js": 'import client from "provider-sdk";',
  };
  expect(
    Object.fromEntries(
      Object.entries(files).map(([filename, code]) => [
        filename,
        linter.verify(code, config, { filename: "/fixture/" + filename }).length,
      ]),
    ),
  ).toEqual({
    "src/metering/wrapper.js": 0,
    "src/page.js": 1,
    "src/lazy.js": 1,
    "src/legacy.js": 1,
    "src/barrel.js": 2,
    "src/app.js": 0,
    "src/metering/nested/bypass.js": 1,
  });
});
test("reports the configured rule and validates config", () => {
  expect(
    linter.verify('import x from "provider-sdk"', config, { filename: "/fixture/src/x.js" }),
  ).toMatchObject([{ ruleId: "usagekit/no-direct-provider-call", messageId: "direct" }]);
  expect(() =>
    linter.verify("", [
      {
        plugins: { usagekit: plugin },
        rules: { "usagekit/no-direct-provider-call": ["error", { modules: [] }] },
      },
    ]),
  ).toThrow();
});
