#!/usr/bin/env node
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RemoteUnavailable, RemoteHttpError } from "@usagekit/client";
import { context, UsageError } from "./context.js";
import { print, rejected } from "./output.js";
import { serve, StartupFailure } from "./commands/serve.js";
import { provider } from "./commands/provider.js";
import { token } from "./commands/token.js";
import { budget } from "./commands/budget.js";
import { usage } from "./commands/usage.js";
import { report } from "./commands/report.js";
export async function main(args = process.argv.slice(2)): Promise<number> {
  const json = args.includes("--json");
  try {
    if (args[0] === "serve") {
      await serve(args.slice(1));
      return 0;
    }
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        ...Object.fromEntries(
          [
            "url",
            "config-dir",
            "connection",
            "secret-env",
            "id",
            "limit",
            "hard-limit",
            "unit",
            "surface",
            "source",
            "group-by",
            "window",
            "from",
            "to",
            "epoch",
            "scope",
            "group",
            "pool",
            "credential-kind",
            "credential-id",
            "provider",
            "feature",
            "estimate",
            "quantity",
            "cost",
            "operation",
            "command-id",
            "lease-ms",
            "reason",
            "cursor",
            "occurred-at",
          ].map((k) => [k, { type: "string" as const }]),
        ),
        alert: { type: "string", multiple: true },
        tag: { type: "string", multiple: true },
        json: { type: "boolean" },
        warn: { type: "boolean" },
        allow: { type: "boolean" },
        unlimited: { type: "boolean" },
        failed: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      print(
        {
          commands: [
            "serve",
            "token show-path|rotate",
            "provider add|list|remove|test",
            "budget set|list",
            "usage",
            "report reserve|settle|release|expire",
          ],
          docs: "docs/LOCAL-SERVER.md",
        },
        json,
      );
      return 0;
    }
    const c = context(values),
      [command, subcommand, name] = positionals;
    if (
      positionals.length >
      (command === "provider" && subcommand === "add" ? 3 : command === "usage" ? 1 : 2)
    )
      throw new UsageError();
    let result: unknown,
      refused = false;
    switch (command) {
      case "provider":
        result = await provider(c, subcommand, name);
        break;
      case "token":
        result = await token(c, subcommand);
        break;
      case "budget":
        result = await budget(c, subcommand);
        break;
      case "usage":
        result = await usage(c);
        break;
      case "report":
        ({ result, refused } = await report(c, subcommand));
        break;
      default:
        throw new UsageError();
    }
    if (
      !json &&
      command === "report" &&
      subcommand === "reserve" &&
      result &&
      typeof result === "object" &&
      "granted" in result &&
      result.granted &&
      "operation" in result
    )
      console.log((result.operation as { operationId: string }).operationId);
    else if (
      !json &&
      command === "usage" &&
      result &&
      typeof result === "object" &&
      "value" in result
    )
      print((result.value as { rows: unknown[] }).rows, false);
    else print(result, json);
    return refused || rejected(result) ? 1 : 0;
  } catch (error) {
    if (error instanceof StartupFailure) {
      if (json) print({ error: error.code, message: error.message }, true);
      else console.error(`${error.code}: ${error.message}`);
      return error.code === "usage_error" ? 2 : 1;
    }
    const code = error instanceof RemoteUnavailable ? 3 : error instanceof RemoteHttpError ? 1 : 2;
    const message =
      code === 3 ? "remote_unavailable" : code === 1 ? "request_rejected" : "usage_error";
    const data = {
      error: message,
      ...(error instanceof RemoteUnavailable ? { requestId: error.requestId } : {}),
    };
    if (json) print(data, true);
    else console.error(message);
    return code;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  void main().then((code) => {
    process.exitCode = code;
  });
