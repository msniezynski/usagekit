export class StartupFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "StartupFailure";
  }
}
export function startupError(error: unknown): StartupFailure {
  if (error instanceof StartupFailure) return error;
  const raw = error instanceof Error ? error : null,
    code = raw && "code" in raw ? String(raw.code) : "";
  if (
    [
      "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
      "ERR_SOCKET_BAD_PORT",
    ].includes(code)
  )
    return new StartupFailure(
      "usage_error",
      "Invalid server arguments. Check --port, --host and --config-dir.",
    );
  if (code === "EADDRINUSE")
    return new StartupFailure("port_in_use", "Port is already in use. Choose another --port.");
  if (code === "EACCES" || code === "EPERM")
    return new StartupFailure(
      "permission_denied",
      "Cannot access the config directory or bind the selected port.",
    );
  const errors: Record<string, [string, string]> = {
    InvalidConfig: ["invalid_config", "Config is invalid. Check config.json."],
    VaultUnlockFailed: [
      "vault_unlock_failed",
      "Cannot unlock the vault. Check the passphrase and vault file.",
    ],
    PassphraseConfirmationMismatch: [
      "passphrase_confirmation_mismatch",
      "Passphrases do not match. No vault was created.",
    ],
    LoopbackOnly: ["loopback_only", "Only loopback binding is supported."],
    "NotSupported: remote TLS": [
      "unsupported_remote_tls",
      "Remote TLS is not implemented. Use loopback.",
    ],
  };
  const entry = raw ? errors[raw.message] : undefined;
  return entry
    ? new StartupFailure(...entry)
    : new StartupFailure(
        "startup_failed",
        "Server failed to start. Check the local configuration.",
      );
}
export async function vaultPassphrase({
  exists,
  prompt,
}: {
  exists: boolean;
  prompt: (label: string) => Promise<string>;
}): Promise<string> {
  const passphrase = await prompt(
    exists
      ? "Vault passphrase (empty leaves it locked): "
      : "New vault passphrase (empty leaves it locked): ",
  );
  if (passphrase && !exists && (await prompt("Confirm new vault passphrase: ")) !== passphrase)
    throw new Error("PassphraseConfirmationMismatch");
  return passphrase;
}
