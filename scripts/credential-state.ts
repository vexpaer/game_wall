import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CREDENTIAL_STATE_KEY_ENV,
  CREDENTIAL_STATE_KEY_FILE_ENV,
  CredentialStateError,
  decryptCredentialState,
  deserializeCredentialState,
  encryptCredentialState,
  generateCredentialStateKey,
  serializeCredentialState,
  writeCredentialFileAtomic
} from "./lib/credential-state";

export type CredentialStateCliResult = "key-generated" | "encrypted" | "decrypted";

const SUCCESS_MESSAGES: Readonly<Record<CredentialStateCliResult, string>> = {
  "key-generated": "密钥文件已生成；请按平台分别保存为 EPIC_STATE_KEY 或 SWITCH_STATE_KEY，绝不能共用，并保留安全的离线副本。",
  encrypted: "凭据状态已加密。",
  decrypted: "凭据状态已解密。"
};

function usageError(): never {
  throw new CredentialStateError("usage");
}

async function readInput(path: string): Promise<Buffer> {
  try {
    return await readFile(resolve(path));
  } catch {
    throw new CredentialStateError("read-failed");
  }
}

function requireStateKey(env: NodeJS.ProcessEnv): string {
  const value = env[CREDENTIAL_STATE_KEY_ENV];
  if (value === undefined) throw new CredentialStateError("invalid-key");
  return value;
}

export async function runCredentialStateCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<CredentialStateCliResult> {
  const [command, inputPath, outputPath, ...extra] = args;

  if (command === "keygen") {
    if (outputPath !== undefined || extra.length > 0) usageError();
    const keyFile = inputPath ?? env[CREDENTIAL_STATE_KEY_FILE_ENV];
    if (!keyFile) usageError();
    await writeCredentialFileAtomic(keyFile, generateCredentialStateKey(), {
      overwrite: false,
      mode: 0o600
    });
    return "key-generated";
  }

  if (
    (command !== "encrypt" && command !== "decrypt") ||
    inputPath === undefined ||
    outputPath === undefined ||
    extra.length > 0
  ) {
    usageError();
  }

  const key = requireStateKey(env);
  const input = await readInput(inputPath);

  if (command === "encrypt") {
    const envelope = encryptCredentialState(input, key);
    await writeCredentialFileAtomic(outputPath, `${serializeCredentialState(envelope)}\n`);
    return "encrypted";
  }

  const envelope = deserializeCredentialState(input.toString("utf8"));
  const plaintext = decryptCredentialState(envelope, key);
  await writeCredentialFileAtomic(outputPath, plaintext);
  return "decrypted";
}

async function main(): Promise<void> {
  try {
    const result = await runCredentialStateCli(process.argv.slice(2));
    console.log(SUCCESS_MESSAGES[result]);
  } catch (error) {
    console.error(
      error instanceof CredentialStateError
        ? error.message
        : "凭据状态操作失败"
    );
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await main();
}
