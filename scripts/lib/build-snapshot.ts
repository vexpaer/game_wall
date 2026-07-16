import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AchievementSummary,
  SiteSnapshot,
  SnapshotSummary,
  SteamGame,
  StoreMetadata
} from "../../src/types/steam";
import { mapConcurrent } from "./concurrency";
import { assertSiteSnapshot } from "./schema";
import { SteamClient, type OwnedGame } from "./steam-client";
import { StoreCache } from "./store-cache";

const EMPTY_STORE: StoreMetadata = {
  developers: [],
  publishers: [],
  genres: [],
  platforms: [],
  screenshots: []
};

const EMPTY_SUMMARY: SnapshotSummary = {
  playedGames: 0,
  totalMinutes: 0,
  recentMinutes: 0,
  unlockedAchievements: 0,
  totalAchievements: 0,
  achievementPercentage: 0,
  perfectGames: 0
};

export interface BuildSnapshotOptions {
  client: SteamClient;
  steamUser: string;
  storeCache: StoreCache;
  now?: () => Date;
}

function summarize(games: readonly SteamGame[]): SnapshotSummary {
  let totalMinutes = 0;
  let recentMinutes = 0;
  let unlockedAchievements = 0;
  let totalAchievements = 0;
  let perfectGames = 0;

  for (const game of games) {
    totalMinutes += game.playtime.foreverMinutes;
    recentMinutes += game.playtime.recentMinutes;
    if (game.achievements.status === "available") {
      unlockedAchievements += game.achievements.unlocked;
      totalAchievements += game.achievements.total;
      if (
        game.achievements.total > 0 &&
        game.achievements.unlocked === game.achievements.total
      ) {
        perfectGames += 1;
      }
    }
  }

  return {
    playedGames: games.length,
    totalMinutes,
    recentMinutes,
    unlockedAchievements,
    totalAchievements,
    achievementPercentage:
      totalAchievements === 0
        ? 0
        : Math.round((unlockedAchievements / totalAchievements) * 10_000) / 100,
    perfectGames
  };
}

function toGame(
  owned: OwnedGame,
  achievements: AchievementSummary,
  store: StoreMetadata | undefined
): SteamGame {
  const game: SteamGame = {
    appId: owned.appId,
    name: owned.name,
    storeUrl: `https://store.steampowered.com/app/${owned.appId}/`,
    communityUrl: `https://steamcommunity.com/app/${owned.appId}/`,
    playtime: {
      foreverMinutes: owned.foreverMinutes,
      recentMinutes: owned.recentMinutes
    },
    achievements,
    store: store ?? { ...EMPTY_STORE }
  };

  if (owned.iconHash) {
    game.iconUrl = `https://media.steampowered.com/steamcommunity/public/images/apps/${owned.appId}/${owned.iconHash}.jpg`;
  }
  if (owned.lastPlayedUnix) game.lastPlayedAt = new Date(owned.lastPlayedUnix * 1_000).toISOString();
  if (owned.windowsMinutes !== undefined) game.playtime.windowsMinutes = owned.windowsMinutes;
  if (owned.macMinutes !== undefined) game.playtime.macMinutes = owned.macMinutes;
  if (owned.linuxMinutes !== undefined) game.playtime.linuxMinutes = owned.linuxMinutes;
  if (owned.deckMinutes !== undefined) game.playtime.deckMinutes = owned.deckMinutes;
  return game;
}

export async function buildSiteSnapshot(options: BuildSnapshotOptions): Promise<SiteSnapshot> {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const steamId = await options.client.resolveSteamId(options.steamUser);
  const profile = await options.client.getProfile(steamId);
  const ownedResult = await options.client.getOwnedGames(steamId);

  if (ownedResult.visibility === "private") {
    return {
      schemaVersion: 1,
      status: "private",
      generatedAt,
      steamId,
      profile,
      summary: { ...EMPTY_SUMMARY },
      games: []
    };
  }

  const played = ownedResult.games
    .filter((game) => game.foreverMinutes > 0)
    .sort((left, right) => left.appId - right.appId);

  if (played.length === 0) {
    return {
      schemaVersion: 1,
      status: "empty",
      generatedAt,
      steamId,
      profile,
      summary: { ...EMPTY_SUMMARY },
      games: []
    };
  }

  const achievements = await mapConcurrent(played, 6, (game) =>
    options.client.getAchievements(steamId, game.appId)
  );

  const storeMetadata = await mapConcurrent(played, 2, async (game) => {
    const cached = options.storeCache.get(game.appId);
    if (cached) return cached;
    const fetched = await options.client.getStoreMetadata(game.appId);
    if (fetched) options.storeCache.set(game.appId, fetched);
    return fetched;
  });
  options.storeCache.save();

  const games = played.map((owned, index) => {
    const achievement = achievements[index];
    if (!achievement) throw new Error(`缺少 app ${owned.appId} 的成就结果`);
    return toGame(owned, achievement, storeMetadata[index]);
  });

  const snapshot: SiteSnapshot = {
    schemaVersion: 1,
    status: "ready",
    generatedAt,
    steamId,
    profile,
    summary: summarize(games),
    games
  };
  assertSiteSnapshot(snapshot);
  return snapshot;
}

export function writeSnapshot(path: string, snapshot: SiteSnapshot): void {
  assertSiteSnapshot(snapshot);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}
