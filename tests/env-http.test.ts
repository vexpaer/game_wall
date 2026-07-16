import assert from "node:assert/strict";
import { test } from "node:test";
import { mapConcurrent } from "../scripts/lib/concurrency";
import { parseEnv } from "../scripts/lib/env";
import { HttpError, requestJson, retryAfterMilliseconds, type FetchLike } from "../scripts/lib/http";

test("parseEnv supports quotes, export and inline comments", () => {
  const parsed = parseEnv(`
    # ignored
    export STEAM_USER = fixture-user
    STEAM_LANGUAGE="schinese"
    HASH=value # comment
    QUOTED='value # kept'
  `);
  assert.deepEqual(parsed, {
    STEAM_USER: "fixture-user",
    STEAM_LANGUAGE: "schinese",
    HASH: "value",
    QUOTED: "value # kept"
  });
});

test("requestJson retries 429 and honors Retry-After", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetch: FetchLike = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response('{"error":"busy"}', {
        status: 429,
        headers: { "retry-after": "2" }
      });
    }
    return new Response('{"ok":true}', { status: 200 });
  };

  const payload = await requestJson("https://example.test/data", {
    fetch,
    retries: 1,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    }
  });
  assert.deepEqual(payload, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});

test("requestJson does not retry ordinary 4xx responses", async () => {
  let calls = 0;
  const fetch: FetchLike = async () => {
    calls += 1;
    return new Response('{"error":"forbidden"}', { status: 403 });
  };
  await assert.rejects(
    requestJson("https://example.test/data", { fetch, retries: 3, sleep: async () => {} }),
    (error: unknown) => error instanceof HttpError && error.status === 403
  );
  assert.equal(calls, 1);
});

test("requestJson aborts timed-out attempts and retries network failures", async () => {
  let calls = 0;
  const fetch: FetchLike = async (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true
      });
    });
  };
  await assert.rejects(
    requestJson("https://example.test/slow", {
      fetch,
      timeoutMs: 2,
      retries: 1,
      sleep: async () => {}
    }),
    /重试后仍失败/u
  );
  assert.equal(calls, 2);
});

test("Retry-After accepts an HTTP date", () => {
  assert.equal(
    retryAfterMilliseconds("Wed, 01 Jan 2025 00:00:03 GMT", Date.parse("2025-01-01T00:00:00Z")),
    3_000
  );
});

test("mapConcurrent preserves input order and enforces the limit", async () => {
  let active = 0;
  let maximum = 0;
  const result = await mapConcurrent([4, 3, 2, 1], 2, async (value) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [8, 6, 4, 2]);
  assert.equal(maximum, 2);
});
