import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeSnapshot } from "./lib/build-snapshot";
import { parseSiteSnapshot } from "./lib/schema";

const sourcePath = resolve(process.cwd(), "tests/fixtures/site-snapshot.json");
const outputPath = resolve(
  process.cwd(),
  process.env.GAME_WALL_DATA_FILE ?? "data/generated/site-snapshot.json"
);
const snapshot = parseSiteSnapshot(JSON.parse(readFileSync(sourcePath, "utf8")) as unknown);
writeSnapshot(outputPath, snapshot);
console.log(`已准备脱敏测试数据：${outputPath}`);
