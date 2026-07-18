import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEpicProvider } from "../scripts/lib/epic-provider";
import type { EpicRawGame } from "../scripts/lib/legendary-client";
import { canonicalIdForGame } from "../src/utils/library";

function epicGame(overrides: Partial<EpicRawGame> = {}): EpicRawGame {
  return {
    source: "epic",
    externalId: "namespace:catalog-id",
    title: "Fixture Game",
    kind: "game",
    owned: true,
    thirdParty: false,
    ...overrides
  };
}

test("Epic provider keeps only owned base games and does not invent playtime", async () => {
  let calls = 0;
  const provider = await buildEpicProvider({
    client: {
      async listGames() {
        calls += 1;
        return [
          epicGame({
            externalId: "partner:item",
            title: "Partner Game",
            thirdParty: true
          }),
          epicGame({ externalId: "dlc:item", title: "Fixture DLC", kind: "dlc" }),
          epicGame({ externalId: "tool:item", title: "Fixture Tool", kind: "other" }),
          epicGame({ externalId: "not-owned:item", title: "Not Owned", owned: false })
        ];
      }
    },
    displayName: "Epic Fixture",
    now: () => new Date("2026-07-18T12:34:56.000Z")
  });

  assert.equal(calls, 1);
  assert.deepEqual(provider.account, {
    source: "epic",
    status: "ready",
    profile: {
      externalId: "Epic Fixture",
      displayName: "Epic Fixture"
    },
    lastSyncedAt: "2026-07-18T12:34:56.000Z"
  });
  assert.equal(provider.games.length, 1);
  assert.deepEqual(provider.games[0], {
    id: "epic:partner:item",
    canonicalId: canonicalIdForGame("epic", "partner:item", "Partner Game"),
    source: "epic",
    externalId: "partner:item",
    name: "Partner Game",
    ownership: "owned",
    playtime: {},
    achievements: {
      status: "unsupported",
      unlocked: 0,
      total: 0,
      percentage: 0
    },
    store: {
      developers: [],
      publishers: [],
      genres: [],
      platforms: ["windows"],
      screenshots: []
    },
    links: {}
  });
  assert.equal("totalMinutes" in (provider.games[0]?.playtime ?? {}), false);
});

test("Epic provider applies aliases and reports an empty default account", async () => {
  const empty = await buildEpicProvider({
    client: { listGames: async () => [] },
    now: () => new Date("2026-07-18T00:00:00.000Z")
  });

  assert.deepEqual(empty, {
    account: {
      source: "epic",
      status: "empty",
      profile: {
        externalId: "legendary-local",
        displayName: "Epic Games"
      },
      lastSyncedAt: "2026-07-18T00:00:00.000Z"
    },
    games: []
  });

  const aliases = { records: { "epic:alias:item": "Shared Canonical Title" } };
  const populated = await buildEpicProvider({
    client: {
      listGames: async () => [epicGame({ externalId: "alias:item", title: "Epic Edition" })]
    },
    aliases,
    now: () => new Date("2026-07-18T00:00:00.000Z")
  });
  assert.equal(
    populated.games[0]?.canonicalId,
    canonicalIdForGame("epic", "alias:item", "Epic Edition", aliases)
  );
});
