import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GameRecord, LibraryGame, SiteSnapshot } from "../types/library";
import { mergeGameRecords } from "./library";

const snapshotPath = resolve(
  process.cwd(),
  process.env.GAME_WALL_DATA_FILE ?? "data/generated/site-snapshot.json"
);

let cachedSnapshot: SiteSnapshot | undefined;

export function getSnapshot(): SiteSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  if (!existsSync(snapshotPath)) {
    throw new Error(
      `未找到站点数据：${snapshotPath}。请运行 npm run library:sync 或 npm run data:fixture。`
    );
  }
  cachedSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as SiteSnapshot;
  return cachedSnapshot;
}

export function getRecord(id: string): GameRecord | undefined {
  return getSnapshot().games.find((game) => game.id === id);
}

export function getLibraryGames(): LibraryGame[] {
  return mergeGameRecords(getSnapshot().games);
}

export function getLibraryGame(canonicalId: string): LibraryGame | undefined {
  return getLibraryGames().find((game) => game.canonicalId === canonicalId);
}
