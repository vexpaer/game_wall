import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { StoreMetadata } from "../src/types/steam";
import { StoreCache } from "../scripts/lib/store-cache";

const METADATA: StoreMetadata = {
  developers: ["Studio"],
  publishers: ["Publisher"],
  genres: ["动作"],
  platforms: ["windows"],
  screenshots: []
};

test("StoreCache persists only public metadata and expires it after seven days", () => {
  const directory = mkdtempSync(join(tmpdir(), "game-wall-cache-"));
  const path = join(directory, "store.json");
  let current = new Date("2026-07-01T00:00:00.000Z");
  const now = () => current;

  const writer = new StoreCache(path, "schinese", { now });
  writer.set(20, METADATA);
  writer.set(10, METADATA);
  writer.save();

  const serialized = readFileSync(path, "utf8");
  assert.ok(serialized.indexOf('"10"') < serialized.indexOf('"20"'));
  assert.equal(serialized.includes("steamId"), false);
  assert.deepEqual(new StoreCache(path, "schinese", { now }).get(10), METADATA);

  current = new Date("2026-07-08T00:00:00.001Z");
  assert.equal(new StoreCache(path, "schinese", { now }).get(10), undefined);
  assert.equal(new StoreCache(path, "english", { now }).get(10), undefined);
});
