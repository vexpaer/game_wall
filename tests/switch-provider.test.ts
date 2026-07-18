import assert from "node:assert/strict";
import test from "node:test";
import { assembleSnapshot } from "../scripts/lib/assemble-snapshot";
import { buildSwitchProvider } from "../scripts/lib/switch-provider";

test("Switch provider preserves unknown playtime and Japanese Lite profile", () => {
  const provider = buildSwitchProvider({
    batch: {
      locale: "ja-JP",
      games: [
        { title: "Played", externalId: "010025400AECE000", playMinutes: 45, system: "switch", ownership: "played" },
        { title: "Owned only", system: "switch", ownership: "owned" },
        { title: "Daily summary", externalId: "01007EF00011E000", lastPlayed: "2026-07-18", system: "switch", ownership: "played" }
      ]
    },
    displayName: "JP account",
    device: "Nintendo Switch Lite",
    now: () => new Date("2026-07-18T00:00:00.000Z")
  });

  assert.equal(provider.account.status, "ready");
  assert.equal(provider.account.profile?.region, "ja-JP");
  assert.equal(provider.account.profile?.device, "Nintendo Switch Lite");
  assert.equal(provider.games[0]?.playtime.totalMinutes, 45);
  assert.equal(provider.games[1]?.lastPlayedPrecision, "date");
  assert.equal(provider.games[1]?.lastPlayedAt, "2026-07-18T00:00:00.000Z");
  assert.deepEqual(provider.games[2]?.playtime, {});
  assert.match(provider.games[2]?.externalId ?? "", /^manual-/u);
  assert.equal(provider.games[0]?.achievements.status, "unsupported");
});

test("Switch provider reports a valid empty connection", () => {
  const provider = buildSwitchProvider({ batch: { locale: "ja-JP", games: [] } });
  assert.equal(provider.account.status, "empty");
  assert.deepEqual(provider.games, []);
});

test("manual IDs remain distinct when canonical edition rules merge titles", () => {
  const provider = buildSwitchProvider({
    batch: {
      locale: "ja-JP",
      games: [
        { title: "Fixture Game", system: "switch", ownership: "owned" },
        { title: "Fixture Game Deluxe Edition", system: "switch", ownership: "owned" }
      ]
    }
  });

  assert.equal(new Set(provider.games.map((game) => game.id)).size, 2);
  assert.equal(provider.games[0]?.canonicalId, provider.games[1]?.canonicalId);
  assert.equal(assembleSnapshot([provider]).summary.platformRecords, 2);
});
