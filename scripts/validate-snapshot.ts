import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSiteSnapshot } from "./lib/schema";

const snapshotPath = resolve(
  process.cwd(),
  process.env.GAME_WALL_DATA_FILE ?? "data/generated/site-snapshot.json"
);

try {
  const snapshot = parseSiteSnapshot(JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown);
  console.log(
    `数据校验通过：${snapshot.status}，${snapshot.summary.uniqueGames} 款唯一游戏 / ${snapshot.games.length} 条平台记录`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`数据校验失败：${message}`);
  process.exitCode = 1;
}
