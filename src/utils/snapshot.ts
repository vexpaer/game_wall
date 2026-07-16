import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SiteSnapshot, SteamGame } from "../types/steam";

const snapshotPath = resolve(
  process.cwd(),
  process.env.GAME_WALL_DATA_FILE ?? "data/generated/site-snapshot.json"
);

let cachedSnapshot: SiteSnapshot | undefined;

export function getSnapshot(): SiteSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  if (!existsSync(snapshotPath)) {
    throw new Error(
      `未找到站点数据：${snapshotPath}。请运行 npm run steam:sync 或 npm run data:fixture。`
    );
  }

  cachedSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as SiteSnapshot;
  return cachedSnapshot;
}

export function getGame(appId: number): SteamGame | undefined {
  return getSnapshot().games.find((game) => game.appId === appId);
}
