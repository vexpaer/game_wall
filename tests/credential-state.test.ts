import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCredentialStateCli } from "../scripts/credential-state";
import {
  CREDENTIAL_STATE_ALGORITHM,
  CREDENTIAL_STATE_VERSION,
  CredentialStateError,
  decryptCredentialState,
  deserializeCredentialState,
  encryptCredentialState,
  generateCredentialStateKey,
  parseCredentialStateEnvelope,
  parseCredentialStateKey,
  serializeCredentialState
} from "../scripts/lib/credential-state";

test("credential state encrypts and decrypts arbitrary bytes", () => {
  const key = generateCredentialStateKey();
  const plaintext = Buffer.from("Epic 刷新状态\n\u0000binary", "utf8");
  const first = encryptCredentialState(plaintext, key);
  const second = encryptCredentialState(plaintext, key);

  assert.equal(first.version, CREDENTIAL_STATE_VERSION);
  assert.equal(first.algorithm, CREDENTIAL_STATE_ALGORITHM);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, plaintext.toString("base64"));
  assert.deepEqual(decryptCredentialState(first, key), plaintext);
  assert.deepEqual(
    decryptCredentialState(deserializeCredentialState(serializeCredentialState(first)), key),
    plaintext
  );
});

test("credential state rejects tampering without leaking sensitive values", () => {
  const key = generateCredentialStateKey();
  const plaintext = "do-not-leak-this-refresh-token";
  const envelope = encryptCredentialState(plaintext, key);
  const changed = Buffer.from(envelope.ciphertext, "base64");
  changed[0] = (changed[0] ?? 0) ^ 1;

  assert.throws(
    () => decryptCredentialState({ ...envelope, ciphertext: changed.toString("base64") }, key),
    (error: unknown) => {
      assert.ok(error instanceof CredentialStateError);
      assert.equal(error.code, "decrypt-failed");
      assert.doesNotMatch(error.message, new RegExp(plaintext, "u"));
      assert.doesNotMatch(error.message, new RegExp(key, "u"));
      return true;
    }
  );
});

test("credential state rejects a different key", () => {
  const envelope = encryptCredentialState("private", generateCredentialStateKey());
  assert.throws(
    () => decryptCredentialState(envelope, generateCredentialStateKey()),
    (error: unknown) => error instanceof CredentialStateError && error.code === "decrypt-failed"
  );
});

test("key and envelope parsers are strict", () => {
  const key = generateCredentialStateKey();
  assert.equal(parseCredentialStateKey(key).length, 32);
  assert.throws(() => parseCredentialStateKey(`${key}\n`), /32 字节/u);
  assert.throws(() => parseCredentialStateKey(Buffer.alloc(31).toString("base64")), /32 字节/u);
  assert.throws(() => parseCredentialStateKey(`_${key.slice(1)}`), /32 字节/u);

  const envelope = encryptCredentialState("state", key);
  assert.throws(
    () => parseCredentialStateEnvelope({ ...envelope, debug: true }),
    /格式无效/u
  );
  assert.throws(
    () => parseCredentialStateEnvelope({ ...envelope, version: 2 }),
    /格式无效/u
  );
  assert.throws(
    () => parseCredentialStateEnvelope({ ...envelope, iv: Buffer.alloc(11).toString("base64") }),
    /格式无效/u
  );
  assert.throws(() => deserializeCredentialState("not-json"), /格式无效/u);
});

test("CLI round-trips through temporary files and keygen never returns the key", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "game-wall-credential-state-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));

  const keyPath = join(directory, "state.key");
  assert.equal(
    await runCredentialStateCli(["keygen", keyPath], {}),
    "key-generated"
  );
  const key = (await readFile(keyPath, "utf8")).trimEnd();
  assert.equal(parseCredentialStateKey(key).length, 32);

  const inputPath = join(directory, "input.bin");
  const encryptedPath = join(directory, "state.enc.json");
  const outputPath = join(directory, "output.bin");
  const plaintext = Buffer.from([0, 1, 2, 127, 128, 255]);
  await writeFile(inputPath, plaintext);

  const env = { GAME_WALL_STATE_KEY: key };
  assert.equal(
    await runCredentialStateCli(["encrypt", inputPath, encryptedPath], env),
    "encrypted"
  );
  assert.equal(
    await runCredentialStateCli(["decrypt", encryptedPath, outputPath], env),
    "decrypted"
  );
  assert.deepEqual(await readFile(outputPath), plaintext);

  await assert.rejects(
    runCredentialStateCli(["keygen", keyPath], {}),
    (error: unknown) => error instanceof CredentialStateError && error.code === "output-exists"
  );
});
