import assert from "node:assert/strict";
import { test } from "node:test";
import { SteamClient, plainTextFromHtml } from "../scripts/lib/steam-client";
import type { FetchLike } from "../scripts/lib/http";

const STEAM_ID = "76561198000000000";
const API_KEY = "test-key-never-write";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("a vanity name resolves through the public Web API host with header authentication", async () => {
  let seen = false;
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    seen = true;
    assert.equal(url.origin, "https://api.steampowered.com");
    assert.equal(url.pathname, "/ISteamUser/ResolveVanityURL/v1/");
    assert.equal(url.searchParams.get("vanityurl"), "fixture-player");
    assert.equal(url.searchParams.has("key"), false);
    assert.equal(new Headers(init?.headers).get("x-webapi-key"), API_KEY);
    return json({ response: { success: 1, steamid: STEAM_ID } });
  };
  const client = new SteamClient({ apiKey: API_KEY, fetch, retries: 0 });
  assert.equal(await client.resolveSteamId("fixture-player"), STEAM_ID);
  assert.equal(seen, true);
});

test("a SteamID64 is accepted without a network request", async () => {
  const client = new SteamClient({
    apiKey: API_KEY,
    fetch: async () => {
      throw new Error("unexpected network call");
    }
  });
  assert.equal(await client.resolveSteamId(STEAM_ID), STEAM_ID);
});

test("owned games validation distinguishes private and public empty libraries", async () => {
  const responses = [json({ response: {} }), json({ response: { game_count: 0 } })];
  const fetch: FetchLike = async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  const client = new SteamClient({ apiKey: API_KEY, fetch, retries: 0 });
  assert.deepEqual(await client.getOwnedGames(STEAM_ID), { visibility: "private" });
  assert.deepEqual(await client.getOwnedGames(STEAM_ID), { visibility: "public", games: [] });
});

test("malformed OwnedGames responses fail validation instead of looking private", async () => {
  const client = new SteamClient({
    apiKey: API_KEY,
    fetch: async () => json({ response: { games: "not-an-array" } }),
    retries: 0
  });
  await assert.rejects(client.getOwnedGames(STEAM_ID), /game_count/u);

  const underfilled = new SteamClient({
    apiKey: API_KEY,
    fetch: async () => json({
      response: {
        game_count: 2,
        games: [{ appid: 10, name: "Only one", playtime_forever: 10 }]
      }
    }),
    retries: 0
  });
  await assert.rejects(underfilled.getOwnedGames(STEAM_ID), /数量必须等于 game_count/u);
});

test("achievement errors distinguish no-stats from temporary unavailability", async () => {
  const responses = [
    json({ playerstats: { success: false, error: "Requested app has no stats" } }, 400),
    json({ error: "no stats service unavailable" }, 503)
  ];
  const fetch: FetchLike = async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected request");
    return response;
  };
  const client = new SteamClient({ apiKey: API_KEY, fetch, retries: 0 });
  assert.deepEqual(await client.getAchievements(STEAM_ID, 10), {
    status: "none",
    unlocked: 0,
    total: 0,
    percentage: 0
  });
  assert.deepEqual(await client.getAchievements(STEAM_ID, 20), {
    status: "unavailable",
    unlocked: 0,
    total: 0,
    percentage: 0
  });
});

test("store metadata is validated, reduced, made HTTPS and stripped to plain text", async () => {
  const fetch: FetchLike = async () =>
    json({
      "10": {
        success: true,
        data: {
          type: "game",
          short_description: "A <b>great</b>&nbsp;game &amp; test.",
          developers: ["Fixture Studio"],
          publishers: ["Fixture Publisher"],
          genres: [{ id: "1", description: "动作" }],
          release_date: { coming_soon: false, date: "2025 年 1 月 1 日" },
          platforms: { windows: true, mac: false, linux: true },
          header_image: "http://cdn.example.test/header.jpg",
          background: "https://cdn.example.test/background.jpg",
          screenshots: Array.from({ length: 6 }, (_, index) => ({
            id: index,
            path_full: `http://cdn.example.test/${index}.jpg`
          }))
        }
      }
    });
  const client = new SteamClient({ apiKey: API_KEY, fetch, retries: 0 });
  const store = await client.getStoreMetadata(10);
  assert.equal(store?.shortDescription, "A great game & test.");
  assert.equal(store?.headerImageUrl, "https://cdn.example.test/header.jpg");
  assert.deepEqual(store?.platforms, ["windows", "linux"]);
  assert.equal(store?.screenshots.length, 4);
  assert.ok(store?.screenshots.every((url) => url.startsWith("https://")));
});

test("plainTextFromHtml decodes numeric entities without rendering markup", () => {
  assert.equal(plainTextFromHtml("Hello<br>&#19990;&#x754C;"), "Hello 世界");
});
