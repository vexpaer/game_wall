import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildSiteSnapshot, writeSnapshot } from "../scripts/lib/build-snapshot";
import type { FetchLike } from "../scripts/lib/http";
import { parseSiteSnapshot } from "../scripts/lib/schema";
import { SteamClient } from "../scripts/lib/steam-client";
import { StoreCache } from "../scripts/lib/store-cache";

const STEAM_ID = "76561198000000000";
const API_KEY = "secret-fixture-key";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function profilePayload(): unknown {
  return {
    response: {
      players: [
        {
          steamid: STEAM_ID,
          personaname: "Fixture Player",
          profileurl: "https://steamcommunity.com/id/fixture/",
          avatarfull: "https://avatars.example.test/full.jpg",
          lastlogoff: 1_720_000_000
        }
      ]
    }
  };
}

function clientForOwnedResponse(ownedResponse: unknown, extra?: FetchLike): SteamClient {
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    if (url.hostname === "api.steampowered.com") {
      assert.equal(url.searchParams.has("key"), false);
      assert.equal(new Headers(init?.headers).get("x-webapi-key"), API_KEY);
      if (url.pathname.includes("GetPlayerSummaries")) return json(profilePayload());
      if (url.pathname.includes("GetOwnedGames")) return json(ownedResponse);
    }
    if (extra) return extra(input, init);
    throw new Error(`unexpected request ${url}`);
  };
  return new SteamClient({ apiKey: API_KEY, fetch, retries: 0, sleep: async () => {} });
}

function cache(now = () => new Date("2026-07-16T02:17:00.000Z")): StoreCache {
  const directory = mkdtempSync(join(tmpdir(), "game-wall-test-"));
  return new StoreCache(join(directory, "store.json"), "schinese", { now });
}

test("buildSiteSnapshot filters unplayed games, retains played free games and is deterministic", async () => {
  const requestedUrls: string[] = [];
  const owned = {
    response: {
      game_count: 3,
      games: [
        { appid: 30, name: "Never Played", playtime_forever: 0 },
        {
          appid: 20,
          name: "Paid Played",
          img_icon_url: "b20",
          playtime_forever: 180,
          playtime_windows_forever: 170,
          playtime_deck_forever: 10,
          rtime_last_played: 1_720_100_000
        },
        {
          appid: 10,
          name: "Played Free Game",
          img_icon_url: "a10",
          playtime_forever: 120,
          playtime_2weeks: 30,
          playtime_linux_forever: 120,
          rtime_last_played: 1_720_000_000
        }
      ]
    }
  };

  const extra: FetchLike = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url.toString());
    if (url.pathname.includes("GetPlayerAchievements")) {
      if (url.searchParams.get("appid") === "10") {
        return json({
          playerstats: {
            success: true,
            achievements: [{ achieved: 1 }, { achieved: 0 }]
          }
        });
      }
      return json({ playerstats: { success: false, error: "Requested app has no stats" } }, 400);
    }
    if (url.hostname === "store.steampowered.com" && url.searchParams.get("appids") === "10") {
      return json({
        "10": {
          success: true,
          data: {
            type: "game",
            short_description: "Free <b>fixture</b>",
            developers: ["Studio"],
            publishers: ["Publisher"],
            genres: [{ description: "动作" }],
            release_date: { coming_soon: false, date: "2025" },
            platforms: { windows: true, mac: false, linux: true },
            header_image: "https://cdn.example.test/10.jpg",
            screenshots: []
          }
        }
      });
    }
    if (url.hostname === "store.steampowered.com") return json({ "20": { success: false } });
    throw new Error(`unexpected request ${url}`);
  };

  const client = clientForOwnedResponse(owned, extra);
  const snapshot = await buildSiteSnapshot({
    client,
    steamUser: STEAM_ID,
    storeCache: cache(),
    now: () => new Date("2026-07-16T02:17:00.000Z")
  });

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.generatedAt, "2026-07-16T02:17:00.000Z");
  assert.deepEqual(snapshot.games.map((game) => game.externalId), ["10", "20"]);
  assert.equal(snapshot.games[0]?.name, "Played Free Game");
  assert.equal(snapshot.games[0]?.store.shortDescription, "Free fixture");
  assert.deepEqual(snapshot.games[1]?.store, {
    developers: [],
    publishers: [],
    genres: [],
    platforms: [],
    screenshots: []
  });
  assert.deepEqual(snapshot.summary, {
    uniqueGames: 2,
    platformRecords: 2,
    playedGames: 2,
    knownPlaytimeRecords: 2,
    totalMinutes: 300,
    recentMinutes: 30,
    unlockedAchievements: 1,
    totalAchievements: 2,
    achievementPercentage: 50,
    perfectGames: 0,
    sourceCounts: { steam: 2, xbox: 0, epic: 0, switch: 0 }
  });
  assert.ok(requestedUrls.every((url) => !url.includes(API_KEY)));
  assert.ok(requestedUrls.every((url) => !url.includes("appid=30") && !url.includes("appids=30")));

  const outputDirectory = mkdtempSync(join(tmpdir(), "game-wall-output-"));
  const outputPath = join(outputDirectory, "snapshot.json");
  writeSnapshot(outputPath, snapshot);
  const serialized = readFileSync(outputPath, "utf8");
  assert.equal(serialized.includes(API_KEY), false);
  assert.deepEqual(parseSiteSnapshot(JSON.parse(serialized) as unknown), snapshot);
});

test("a valid empty OwnedGames response produces the private state", async () => {
  const snapshot = await buildSiteSnapshot({
    client: clientForOwnedResponse({ response: {} }),
    steamUser: STEAM_ID,
    storeCache: cache(),
    now: () => new Date("2026-07-16T02:17:00.000Z")
  });
  assert.equal(snapshot.status, "empty");
  assert.deepEqual(snapshot.games, []);
  assert.equal(snapshot.accounts[0]?.status, "private");
  assert.equal(snapshot.accounts[0]?.profile?.displayName, "Fixture Player");
});

test("a public library with only unplayed games produces the empty state", async () => {
  const snapshot = await buildSiteSnapshot({
    client: clientForOwnedResponse({
      response: {
        game_count: 1,
        games: [{ appid: 10, name: "Unplayed", playtime_forever: 0 }]
      }
    }),
    steamUser: STEAM_ID,
    storeCache: cache(),
    now: () => new Date("2026-07-16T02:17:00.000Z")
  });
  assert.equal(snapshot.status, "empty");
  assert.deepEqual(snapshot.summary, {
    uniqueGames: 0,
    platformRecords: 0,
    playedGames: 0,
    knownPlaytimeRecords: 0,
    totalMinutes: 0,
    recentMinutes: 0,
    unlockedAchievements: 0,
    totalAchievements: 0,
    achievementPercentage: 0,
    perfectGames: 0,
    sourceCounts: { steam: 0, xbox: 0, epic: 0, switch: 0 }
  });
});

test("profile authentication failures are fatal", async () => {
  const client = new SteamClient({
    apiKey: API_KEY,
    retries: 0,
    fetch: async () => json({ error: "invalid key" }, 403)
  });
  await assert.rejects(
    buildSiteSnapshot({ client, steamUser: STEAM_ID, storeCache: cache() }),
    /HTTP 403/u
  );
});

test("the checked-in fixture is a valid deterministic snapshot", () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/site-snapshot.json", "utf8")) as unknown;
  const parsed = parseSiteSnapshot(fixture);
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.summary.uniqueGames, 7);
  assert.equal(parsed.summary.platformRecords, 9);
  assert.deepEqual(parsed.games.filter((game) => game.canonicalId === "fortnite-33ee0b2a").map((game) => game.source), ["xbox", "epic", "switch"]);
});

test("snapshot validation rejects internally inconsistent or polluted data", () => {
  const fixture = JSON.parse(readFileSync("tests/fixtures/site-snapshot.json", "utf8")) as any;

  const wrongAchievement = structuredClone(fixture);
  wrongAchievement.games[0].achievements.percentage = 99;
  assert.throws(() => parseSiteSnapshot(wrongAchievement), /percentage/u);

  const wrongSummary = structuredClone(fixture);
  wrongSummary.summary.totalMinutes += 1;
  assert.throws(() => parseSiteSnapshot(wrongSummary), /summary.totalMinutes/u);

  const wrongProfile = structuredClone(fixture);
  wrongProfile.accounts[0].source = "xbox";
  assert.throws(() => parseSiteSnapshot(wrongProfile), /snapshot.accounts/u);

  const pollutedStore = structuredClone(fixture);
  pollutedStore.games[0].store.apiKey = "must-not-survive";
  assert.throws(() => parseSiteSnapshot(pollutedStore), /不是允许的字段/u);

  const nonZeroEmpty = structuredClone(fixture);
  nonZeroEmpty.status = "empty";
  nonZeroEmpty.games = [];
  assert.throws(() => parseSiteSnapshot(nonZeroEmpty), /summary\.(?:uniqueGames|playedGames)/u);
});
