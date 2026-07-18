import assert from "node:assert/strict";
import { test } from "node:test";
import type { FetchLike } from "../scripts/lib/http";
import { OpenXblClient, OpenXblError } from "../scripts/lib/openxbl-client";

const API_KEY = "fixture-openxbl-key-never-use";
const XUID = "2533274798129181";

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function accountPayload(): unknown {
  return {
    profileUsers: [
      {
        id: XUID,
        hostId: XUID,
        settings: [
          { id: "GameDisplayPicRaw", value: "http://images.example.test/avatar.png" },
          { id: "Gamerscore", value: "19165" },
          { id: "Gamertag", value: "Fixture Player" },
          { id: "AccountTier", value: "Gold" }
        ],
        isSponsoredUser: false
      }
    ]
  };
}

function achievement(
  id: string,
  progressState: "Achieved" | "InProgress" | "NotStarted",
  gamerscore: string
): unknown {
  return {
    id,
    serviceConfigId: "b5dd9daf-0000-0000-0000-000000000000",
    name: `Achievement ${id}`,
    titleAssociations: [{ name: "Fixture Game", id: 1_777_860_928, version: "1" }],
    progressState,
    progression: {
      requirements: [{ id: "requirement", current: "1", target: "1" }],
      timeUnlocked: progressState === "Achieved" ? "2026-07-18T12:34:56.1234567Z" : null
    },
    mediaAssets: [
      { name: "Icon", type: "Icon", url: `http://images.example.test/achievement-${id}.png` }
    ],
    platforms: ["XboxOne"],
    isSecret: false,
    description: `Unlocked ${id}`,
    lockedDescription: `Locked ${id}`,
    productId: "12345678-1234-1234-1234-123456789012",
    achievementType: "Persistent",
    participationType: "Individual",
    timeWindow: null,
    rewards: [
      { name: null, description: null, value: gamerscore, type: "Gamerscore", valueType: "Int" }
    ],
    estimatedTime: "00:10:00",
    deeplink: "fixture",
    isRevoked: false
  };
}

test("account uses only X-Authorization for the API key and maps profile settings", async () => {
  let seen = false;
  const fetch: FetchLike = async (input, init) => {
    seen = true;
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    assert.equal(url.toString(), "https://api.xbl.io/api/v2/account");
    assert.equal(url.toString().includes(API_KEY), false);
    assert.equal(headers.get("X-Authorization"), API_KEY);
    assert.equal(headers.get("Authorization"), null);
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(init?.body, undefined);
    return json(accountPayload());
  };

  const client = new OpenXblClient({ apiKey: ` ${API_KEY} `, fetch, retries: 0 });
  assert.deepEqual(await client.getAccount(), {
    xuid: XUID,
    gamertag: "Fixture Player",
    gamerscore: 19_165,
    avatarUrl: "https://images.example.test/avatar.png",
    accountTier: "Gold"
  });
  assert.equal(seen, true);
});

test("title history validates the XUID and maps history, artwork and achievement summary", async () => {
  const fetch: FetchLike = async (input) => {
    assert.equal(
      new URL(input).toString(),
      `https://api.xbl.io/api/v2/player/titleHistory/${XUID}`
    );
    return json({
      xuid: XUID,
      titles: [
        {
          titleId: "1777860928",
          name: "Fixture Game",
          type: "Game",
          devices: ["XboxOne", "Scarlett"],
          displayImage: "http://images.example.test/game.png",
          achievement: {
            currentAchievements: 8,
            totalAchievements: 23,
            currentGamerscore: 80,
            totalGamerscore: 215,
            progressPercentage: 37
          },
          titleHistory: { lastTimePlayed: "2026-07-18T08:09:10.9876543Z" }
        }
      ]
    });
  };

  const client = new OpenXblClient({ apiKey: API_KEY, fetch, retries: 0 });
  assert.deepEqual(await client.getTitleHistory(XUID), [
    {
      titleId: "1777860928",
      name: "Fixture Game",
      type: "Game",
      devices: ["XboxOne", "Scarlett"],
      imageUrl: "https://images.example.test/game.png",
      lastPlayedAt: "2026-07-18T08:09:10.987Z",
      achievements: {
        unlocked: 8,
        total: 23,
        earnedGamerscore: 80,
        totalGamerscore: 215,
        percentage: 37
      }
    }
  ]);
});

test("detailed achievements map safe display fields and calculate a summary", async () => {
  const fetch: FetchLike = async (input) => {
    assert.equal(
      new URL(input).toString(),
      `https://api.xbl.io/api/v2/achievements/player/${XUID}/1777860928`
    );
    return json({
      achievements: [achievement("1", "Achieved", "10"), achievement("2", "InProgress", "20")],
      pagingInfo: { continuationToken: "next-page", totalRecords: 3 }
    });
  };
  const client = new OpenXblClient({ apiKey: API_KEY, fetch, retries: 0 });

  const result = await client.getAchievements(XUID, 1_777_860_928);
  assert.deepEqual(
    {
      titleId: result.titleId,
      unlocked: result.unlocked,
      total: result.total,
      earnedGamerscore: result.earnedGamerscore,
      totalGamerscore: result.totalGamerscore,
      percentage: result.percentage,
      continuationToken: result.continuationToken,
      totalRecords: result.totalRecords
    },
    {
      titleId: "1777860928",
      unlocked: 1,
      total: 2,
      earnedGamerscore: 10,
      totalGamerscore: 30,
      percentage: 50,
      continuationToken: "next-page",
      totalRecords: 3
    }
  );
  assert.deepEqual(result.achievements[0], {
    id: "1",
    name: "Achievement 1",
    description: "Unlocked 1",
    lockedDescription: "Locked 1",
    progressState: "Achieved",
    unlocked: true,
    gamerscore: 10,
    isSecret: false,
    isRevoked: false,
    platforms: ["XboxOne"],
    iconUrl: "https://images.example.test/achievement-1.png",
    unlockedAt: "2026-07-18T12:34:56.123Z"
  });
});

test("external payloads fail closed when required fields are malformed", async () => {
  const malformedAccount = new OpenXblClient({
    apiKey: API_KEY,
    fetch: async () => {
      const payload = accountPayload() as {
        profileUsers: Array<{ settings: Array<{ id: string; value: string }> }>;
      };
      const score = payload.profileUsers[0]?.settings.find((setting) => setting.id === "Gamerscore");
      if (score) score.value = "19k";
      return json(payload);
    },
    retries: 0
  });
  await assert.rejects(malformedAccount.getAccount(), /无符号十进制整数/u);

  const mismatchedHistory = new OpenXblClient({
    apiKey: API_KEY,
    fetch: async () => json({ xuid: "2533274798129182", titles: [] }),
    retries: 0
  });
  await assert.rejects(mismatchedHistory.getTitleHistory(XUID), /不匹配/u);

  const malformedAchievements = new OpenXblClient({
    apiKey: API_KEY,
    fetch: async () => {
      const item = achievement("1", "Achieved", "10") as Record<string, unknown>;
      item.progressState = "DefinitelyUnlocked";
      return json({ achievements: [item] });
    },
    retries: 0
  });
  await assert.rejects(malformedAchievements.getAchievements(XUID, 1), /未知的成就进度状态/u);
});

test("invalid identifiers are rejected before any request is made", async () => {
  let calls = 0;
  const client = new OpenXblClient({
    apiKey: API_KEY,
    fetch: async () => {
      calls += 1;
      return json({});
    }
  });
  await assert.rejects(client.getTitleHistory("../account"), /XUID/u);
  await assert.rejects(client.getAchievements(XUID, "1/../../account"), /无符号十进制整数/u);
  assert.equal(calls, 0);
});

test("429 responses reuse requestJson retry and Retry-After behavior", async () => {
  let calls = 0;
  const waits: number[] = [];
  const fetch: FetchLike = async () => {
    calls += 1;
    if (calls === 1) return json({ error: "rate limited" }, 429, { "retry-after": "2" });
    return json(accountPayload());
  };
  const client = new OpenXblClient({
    apiKey: API_KEY,
    fetch,
    retries: 1,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    }
  });

  assert.equal((await client.getAccount()).gamertag, "Fixture Player");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2_000]);
});

test("timeouts are delegated to requestJson and surface a sanitized error", async () => {
  let calls = 0;
  const fetch: FetchLike = async (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException(`aborted ${API_KEY}`, "AbortError")),
        { once: true }
      );
    });
  };
  const client = new OpenXblClient({ apiKey: API_KEY, fetch, timeoutMs: 2, retries: 0 });

  await assert.rejects(client.getAccount(), (error: unknown) => {
    assert.ok(error instanceof OpenXblError);
    assert.equal(error.status, undefined);
    assert.equal(error.message.includes(API_KEY), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(calls, 1);
});

test("HTTP errors discard untrusted payloads and never retain the API key", async () => {
  const client = new OpenXblClient({
    apiKey: API_KEY,
    fetch: async () => json({ echoedCredential: API_KEY }, 403),
    retries: 0
  });

  await assert.rejects(client.getAccount(), (error: unknown) => {
    assert.ok(error instanceof OpenXblError);
    assert.equal(error.status, 403);
    assert.equal(error.message, "OpenXBL 请求失败（HTTP 403）");
    assert.equal(error.message.includes(API_KEY), false);
    assert.equal(error.cause, undefined);
    assert.equal("payload" in error, false);
    return true;
  });
});

test("validation errors redact a credential echoed inside a successful response", async () => {
  const echoed = achievement(API_KEY, "Achieved", "10");
  const client = new OpenXblClient({
    apiKey: API_KEY,
    fetch: async () => json({ achievements: [echoed, echoed] }),
    retries: 0
  });

  await assert.rejects(client.getAchievements(XUID, 1), (error: unknown) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.message.includes(API_KEY), false);
    assert.match(error.message, /\[REDACTED\]/u);
    assert.equal(error.cause, undefined);
    return true;
  });
});
