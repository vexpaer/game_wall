import assert from "node:assert/strict";
import test from "node:test";
import { assembleSnapshot } from "../scripts/lib/assemble-snapshot";
import type { GameRecord } from "../src/types/library";
import {
  canonicalIdForGame,
  emptyAchievements,
  emptyStore,
  mergeGameRecords,
  normalizeGameTitle,
  summarizeLibrary
} from "../src/utils/library";

function record(
  source: GameRecord["source"],
  externalId: string,
  name: string,
  minutes?: number
): GameRecord {
  const playtime: GameRecord["playtime"] = {};
  if (minutes !== undefined) playtime.totalMinutes = minutes;
  return {
    id: `${source}:${externalId}`,
    canonicalId: canonicalIdForGame(source, externalId, name),
    source,
    externalId,
    name,
    ownership: "owned",
    playtime,
    achievements: emptyAchievements("unsupported"),
    store: emptyStore(),
    links: {}
  };
}

test("canonical titles merge case, punctuation and ordinary edition suffixes", () => {
  const steam = record("steam", "1", "Control Ultimate Edition", 120);
  const epic = record("epic", "namespace:item", "CONTROL", undefined);
  assert.equal(steam.canonicalId, epic.canonicalId);
  assert.equal(normalizeGameTitle("Control™ Ultimate Edition"), "control");

  const [merged] = mergeGameRecords([steam, epic]);
  assert.deepEqual(merged?.sources, ["steam", "epic"]);
  assert.equal(merged?.playtime.totalMinutes, 120);
  assert.equal(merged?.records[1]?.playtime.totalMinutes, undefined);
});

test("remasters remain separate unless a committed alias explicitly joins them", () => {
  const original = canonicalIdForGame("steam", "1", "Example Game");
  const remaster = canonicalIdForGame("xbox", "2", "Example Game Remastered");
  assert.notEqual(original, remaster);
  assert.equal(
    canonicalIdForGame("xbox", "2", "Example Game Remastered", {
      records: { "xbox:2": "Example Game" }
    }),
    original
  );
});

test("summary distinguishes unique games, provider records and known coverage", () => {
  const steam = record("steam", "1", "Shared", 60);
  const xbox = record("xbox", "2", "Shared");
  xbox.lastPlayedAt = "2026-07-18T00:00:00.000Z";
  const epic = record("epic", "3", "Only Epic");
  const summary = summarizeLibrary([steam, xbox, epic]);
  assert.equal(summary.uniqueGames, 2);
  assert.equal(summary.platformRecords, 3);
  assert.equal(summary.knownPlaytimeRecords, 1);
  assert.equal(summary.totalMinutes, 60);
  assert.equal(summary.playedGames, 1);
  assert.deepEqual(summary.sourceCounts, { steam: 1, xbox: 1, epic: 1, switch: 0 });
});

test("played ownership counts even when a provider cannot supply time or a date", () => {
  const xbox = record("xbox", "2", "History Only");
  xbox.ownership = "played";
  assert.equal(summarizeLibrary([xbox]).playedGames, 1);
});

test("merged metadata fills missing scalar fields from non-primary records", () => {
  const steam = record("steam", "1", "Shared");
  steam.store.headerImageUrl = "https://cdn.example.test/header.jpg";
  steam.store.genres = ["Action", "Adventure", "Puzzle"];
  const epic = record("epic", "2", "Shared");
  epic.store.shortDescription = "Description from another source";
  epic.store.backgroundImageUrl = "https://cdn.example.test/background.jpg";

  const [merged] = mergeGameRecords([steam, epic]);
  assert.equal(merged?.primary.source, "steam");
  assert.equal(merged?.store.shortDescription, "Description from another source");
  assert.equal(merged?.store.backgroundImageUrl, "https://cdn.example.test/background.jpg");
});

test("snapshot assembly rejects duplicate providers and source mismatches", () => {
  const steamAccount = { source: "steam", status: "ready" } as const;
  const steam = { account: steamAccount, games: [record("steam", "1", "Steam Game")] };
  assert.throws(
    () => assembleSnapshot([steam, { account: steamAccount, games: [] }]),
    /重复 provider/u
  );
  assert.throws(
    () => assembleSnapshot([{ account: steamAccount, games: [record("xbox", "2", "Xbox Game")] }]),
    /来源不匹配/u
  );
});

test("merged perfect count uses the same aggregate achievement rule as merged cards", () => {
  const steam = record("steam", "1", "Shared");
  steam.achievements = { status: "available", unlocked: 10, total: 10, percentage: 100 };
  const xbox = record("xbox", "2", "Shared");
  xbox.achievements = { status: "available", unlocked: 0, total: 10, percentage: 0 };

  assert.equal(mergeGameRecords([steam, xbox])[0]?.achievements.percentage, 50);
  assert.equal(summarizeLibrary([steam, xbox]).perfectGames, 0);
});

test("snapshot assembly rejects ambiguous same-source same-title records", () => {
  const first = record("steam", "1", "Prey");
  const second = record("steam", "2", "Prey");
  assert.throws(
    () => assembleSnapshot([{
      account: { source: "steam", status: "ready" },
      games: [first, second]
    }]),
    /aliases\.records/u
  );
});
