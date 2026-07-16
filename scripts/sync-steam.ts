import { resolve } from "node:path";
import { buildSiteSnapshot, writeSnapshot } from "./lib/build-snapshot";
import { loadLocalEnv, requireEnv } from "./lib/env";
import { SteamClient } from "./lib/steam-client";
import { StoreCache } from "./lib/store-cache";

async function main(): Promise<void> {
  loadLocalEnv();
  const apiKey = requireEnv(process.env, "STEAM_API_KEY");
  const steamUser = requireEnv(process.env, "STEAM_USER");
  const language = process.env.STEAM_LANGUAGE?.trim() || "schinese";
  const safeLanguage = language.replace(/[^a-z0-9_-]/giu, "_");
  const cachePath = process.env.GAME_WALL_STORE_CACHE
    ? resolve(process.cwd(), process.env.GAME_WALL_STORE_CACHE)
    : resolve(
        process.cwd(),
        process.env.STEAM_STORE_CACHE_DIR ?? "data/cache/store",
        `store-${safeLanguage}.json`
      );
  const configuredTtl = Number(process.env.STEAM_STORE_CACHE_TTL_MS ?? 7 * 24 * 60 * 60 * 1_000);
  if (!Number.isFinite(configuredTtl) || configuredTtl < 0) {
    throw new Error("STEAM_STORE_CACHE_TTL_MS 必须是非负数字");
  }
  const outputPath = resolve(
    process.cwd(),
    process.env.GAME_WALL_DATA_FILE ?? "data/generated/site-snapshot.json"
  );

  const client = new SteamClient({ apiKey, language });
  const storeCache = new StoreCache(cachePath, language, { ttlMs: configuredTtl });
  const snapshot = await buildSiteSnapshot({ client, steamUser, storeCache });
  writeSnapshot(outputPath, snapshot);

  console.log(
    `Steam 数据同步完成：${snapshot.status}，${snapshot.summary.playedGames} 款游戏 -> ${outputPath}`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Steam 数据同步失败：${message}`);
  process.exitCode = 1;
});
