import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { startServer } from "./index.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultConfigDir } from "./config.js";
import { vaultPassphrase, startupError } from "./startup.js";
export { StartupFailure } from "./startup.js";
async function launch(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string" },
      json: { type: "boolean" },
      host: { type: "string" },
      "config-dir": { type: "string" },
      "strict-proxy": { type: "boolean" },
      providers: { type: "string" },
      "allow-remote": { type: "boolean" },
    },
  });
  let passphrase = process.env.USAGEKIT_VAULT_PASSPHRASE;
  if (!passphrase && process.stdin.isTTY) {
    passphrase = await vaultPassphrase({
      exists: existsSync(join(values["config-dir"] ?? defaultConfigDir(), "vault.enc")),
      prompt: async (label) => {
        process.stderr.write(label);
        const hidden = new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        });
        const reader = createInterface({ input: process.stdin, output: hidden, terminal: true });
        try {
          return await reader.question("");
        } finally {
          reader.close();
          process.stderr.write("\n");
        }
      },
    });
  }

  const server = await startServer({
    ...(values["strict-proxy"] ? { strictProxy: true } : {}),
    ...(values.providers !== undefined
      ? {
          enabledProviders: values.providers
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        }
      : {}),
    ...(values.port ? { port: Number(values.port) } : {}),
    ...(values.host ? { host: values.host } : {}),
    ...(values["config-dir"] ? { configDir: values["config-dir"] } : {}),
    ...(values["allow-remote"] ? { allowRemote: true } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(values.json
      ? { onToken: (token: string) => console.log(JSON.stringify({ event: "token", token })) }
      : {}),
  });
  console.log(
    values.json
      ? JSON.stringify({ event: "listening", url: server.url })
      : `usagekit listening on ${server.url}`,
  );
  const stop = () => {
    void server.stop().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return server;
}
export async function serverMain(args = process.argv.slice(2)) {
  try {
    return await launch(args);
  } catch (error) {
    throw startupError(error);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  serverMain().catch((error) => {
    const failure = startupError(error);
    console.error(`${failure.code}: ${failure.message}`);
    process.exitCode = 1;
  });
