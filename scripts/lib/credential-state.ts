import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export const CREDENTIAL_STATE_VERSION = 1 as const;
export const CREDENTIAL_STATE_ALGORITHM = "aes-256-gcm" as const;
export const CREDENTIAL_STATE_KEY_ENV = "GAME_WALL_STATE_KEY" as const;
export const CREDENTIAL_STATE_KEY_FILE_ENV = "GAME_WALL_STATE_KEY_FILE" as const;

const STATE_AAD = Buffer.from("game-wall/credential-state/v1", "utf8");
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_KEYS = [
  "algorithm",
  "ciphertext",
  "iv",
  "tag",
  "version"
] as const;
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export type CredentialStateErrorCode =
  | "invalid-key"
  | "invalid-envelope"
  | "decrypt-failed"
  | "read-failed"
  | "write-failed"
  | "output-exists"
  | "usage";

const ERROR_MESSAGES: Readonly<Record<CredentialStateErrorCode, string>> = {
  "invalid-key": `${CREDENTIAL_STATE_KEY_ENV} 必须是 32 字节的标准 Base64 值`,
  "invalid-envelope": "加密凭据状态格式无效",
  "decrypt-failed": "加密凭据状态无法解密",
  "read-failed": "无法读取输入文件",
  "write-failed": "无法写入输出文件",
  "output-exists": "密钥输出文件已存在",
  usage: "凭据状态命令参数无效"
};

export class CredentialStateError extends Error {
  readonly code: CredentialStateErrorCode;

  constructor(code: CredentialStateErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "CredentialStateError";
    this.code = code;
  }
}
export interface CredentialStateEnvelope {
  version: typeof CREDENTIAL_STATE_VERSION;
  algorithm: typeof CREDENTIAL_STATE_ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface AtomicWriteOptions {
  overwrite?: boolean;
  mode?: number;
}

function fail(code: CredentialStateErrorCode): never {
  throw new CredentialStateError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeCanonicalBase64(
  value: unknown,
  expectedBytes: number | undefined,
  allowEmpty = false
): Buffer | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0) return allowEmpty ? Buffer.alloc(0) : undefined;
  if (!STANDARD_BASE64.test(value)) return undefined;

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return undefined;
  if (expectedBytes !== undefined && decoded.length !== expectedBytes) return undefined;
  return decoded;
}

/** Creates a fresh key suitable for the GAME_WALL_STATE_KEY GitHub secret. */
export function generateCredentialStateKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/** Strictly parses GAME_WALL_STATE_KEY without accepting Base64URL or whitespace. */
export function parseCredentialStateKey(value: string | undefined): Buffer {
  const key = decodeCanonicalBase64(value, KEY_BYTES);
  if (key === undefined) fail("invalid-key");
  return key;
}

export function parseCredentialStateEnvelope(value: unknown): CredentialStateEnvelope {
  if (!isRecord(value)) fail("invalid-envelope");

  const keys = Object.keys(value).sort();
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    !keys.every((key, index) => key === ENVELOPE_KEYS[index])
  ) {
    fail("invalid-envelope");
  }

  if (
    value.version !== CREDENTIAL_STATE_VERSION ||
    value.algorithm !== CREDENTIAL_STATE_ALGORITHM ||
    decodeCanonicalBase64(value.iv, IV_BYTES) === undefined ||
    decodeCanonicalBase64(value.tag, TAG_BYTES) === undefined ||
    decodeCanonicalBase64(value.ciphertext, undefined, true) === undefined
  ) {
    fail("invalid-envelope");
  }

  return {
    version: CREDENTIAL_STATE_VERSION,
    algorithm: CREDENTIAL_STATE_ALGORITHM,
    iv: value.iv as string,
    tag: value.tag as string,
    ciphertext: value.ciphertext as string
  };
}

export function deserializeCredentialState(serialized: string): CredentialStateEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    fail("invalid-envelope");
  }
  return parseCredentialStateEnvelope(value);
}

export function serializeCredentialState(envelope: CredentialStateEnvelope): string {
  const validEnvelope = parseCredentialStateEnvelope(envelope);
  return JSON.stringify(validEnvelope);
}

export function encryptCredentialState(
  plaintext: string | Uint8Array,
  encodedKey: string
): CredentialStateEnvelope {
  const key = parseCredentialStateKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CREDENTIAL_STATE_ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES
  });
  cipher.setAAD(STATE_AAD);

  const input = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : Buffer.from(plaintext);
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);

  return {
    version: CREDENTIAL_STATE_VERSION,
    algorithm: CREDENTIAL_STATE_ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function decryptCredentialState(
  envelopeValue: unknown,
  encodedKey: string
): Buffer {
  const key = parseCredentialStateKey(encodedKey);
  const envelope = parseCredentialStateEnvelope(envelopeValue);
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  try {
    const decipher = createDecipheriv(CREDENTIAL_STATE_ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES
    });
    decipher.setAAD(STATE_AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    fail("decrypt-failed");
  }
}

/**
 * Writes in the destination directory and publishes with a single rename/link.
 * create-only mode is used for key files so an existing key is never replaced.
 */
export async function writeCredentialFileAtomic(
  destination: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const output = resolve(destination);
  const outputDirectory = dirname(output);
  const overwrite = options.overwrite ?? true;
  const mode = options.mode ?? 0o600;
  const temporary = resolve(
    outputDirectory,
    `.${basename(output)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );

  try {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(temporary, data, { flag: "wx", mode });
    await chmod(temporary, mode);

    if (overwrite) {
      await rename(temporary, output);
    } else {
      try {
        await link(temporary, output);
      } catch (error) {
        if (
          isRecord(error) &&
          (error.code === "EEXIST" || error.code === "EPERM")
        ) {
          fail("output-exists");
        }
        throw error;
      }
      await rm(temporary, { force: true });
    }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (error instanceof CredentialStateError) throw error;
    fail("write-failed");
  }
}
