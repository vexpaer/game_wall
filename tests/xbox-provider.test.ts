import assert from "node:assert/strict";
import { test } from "node:test";
import { buildXboxProvider, type XboxProviderClient } from "../scripts/lib/xbox-provider";
import type { OpenXblAccount, OpenXblTitle } from "../scripts/lib/openxbl-client";
import { canonicalIdForGame } from "../src/utils/library";

const XUID = "2533274798129181";
const NOW = new Date("2026-07-18T09:10:11.000Z");

const account: OpenXblAccount = {
  xuid: XUID,
  gamertag: "Fixture Player + One",
  gamerscore: 19_165,
  avatarUrl: "https://images.example.test/avatar.png",
  accountTier: "Gold"
};

function fixtureClient(titles: OpenXblTitle[]): XboxProviderClient {
  return {
    async getAccount() {
      return account;
    },
    async getTitleHistory(xuid) {
      assert.equal(xuid, XUID);
      return titles;
    }
  };
}

test("maps account and title history without inventing playtime", async () => {
  const provider = await buildXboxProvider({
    client: fixtureClient([
      {
        titleId: "20",
        name: "Fixture Game Deluxe Edition",
        type: "Game",
        devices: ["XboxOne", "Scarlett", "XboxOne"],
        imageUrl: "https://images.example.test/game.png",
        lastPlayedAt: "2026-07-17T08:09:10.000Z",
        achievements: {
          unlocked: 1,
          total: 3,
          earnedGamerscore: 10,
          totalGamerscore: 30,
          // The provider must derive this value from unlocked / total.
          percentage: 99
        }
      },
      {
        titleId: "3",
        name: "Earlier Id",
        type: "Game",
        devices: ["Xbox360"]
      }
    ]),
    aliases: { titles: { "fixture game": "Shared Fixture" } },
    now: () => NOW
  });

  assert.deepEqual(provider.account, {
    source: "xbox",
    status: "ready",
    profile: {
      externalId: XUID,
      displayName: "Fixture Player + One",
      profileUrl: "https://account.xbox.com/profile?gamertag=Fixture+Player+%2B+One",
      avatarUrl: "https://images.example.test/avatar.png"
    },
    lastSyncedAt: NOW.toISOString()
  });
  assert.deepEqual(provider.games.map((game) => game.externalId), ["3", "20"]);

  const game = provider.games[1];
  assert.ok(game);
  assert.equal(game.id, "xbox:20");
  assert.equal(
    game.canonicalId,
    canonicalIdForGame(
      "xbox",
      "20",
      "Fixture Game Deluxe Edition",
      { titles: { "fixture game": "Shared Fixture" } }
    )
  );
  assert.equal(game.ownership, "played");
  assert.deepEqual(game.playtime, {});
  assert.equal("totalMinutes" in game.playtime, false);
  assert.deepEqual(game.achievements, {
    status: "available",
    unlocked: 1,
    total: 3,
    percentage: 33.33
  });
  assert.equal(game.iconUrl, "https://images.example.test/game.png");
  assert.equal(game.lastPlayedAt, "2026-07-17T08:09:10.000Z");
  assert.deepEqual(game.store, {
    type: "Game",
    developers: [],
    publishers: [],
    genres: [],
    platforms: ["XboxOne", "Scarlett"],
    headerImageUrl: "https://images.example.test/game.png",
    screenshots: []
  });
  assert.deepEqual(game.links, {});
});

test("distinguishes missing achievements from a confirmed zero-achievement title", async () => {
  const provider = await buildXboxProvider({
    client: fixtureClient([
      {
        titleId: "1",
        name: "No Achievement Data",
        type: "Game",
        devices: []
      },
      {
        titleId: "2",
        name: "Confirmed No Achievements",
        type: "Game",
        devices: [],
        achievements: {
          unlocked: 0,
          total: 0,
          earnedGamerscore: 0,
          totalGamerscore: 0,
          percentage: 0
        }
      }
    ]),
    now: () => NOW
  });

  assert.equal(provider.games[0]?.achievements.status, "unavailable");
  assert.equal(provider.games[1]?.achievements.status, "none");
});

test("an account with no title history is an empty, successfully synced provider", async () => {
  const provider = await buildXboxProvider({
    client: fixtureClient([]),
    now: () => NOW
  });

  assert.equal(provider.account.status, "empty");
  assert.deepEqual(provider.games, []);
  assert.equal(provider.account.lastSyncedAt, NOW.toISOString());
});

test("client failures are rebuilt without an unsafe message or cause", async () => {
  const unsafe = "fixture-secret-that-must-not-leak";
  const client: XboxProviderClient = {
    async getAccount() {
      throw new Error(`request failed with ${unsafe}`);
    },
    async getTitleHistory() {
      throw new Error("not reached");
    }
  };

  await assert.rejects(buildXboxProvider({ client }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Xbox 账户读取失败");
    assert.equal(error.message.includes(unsafe), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});
