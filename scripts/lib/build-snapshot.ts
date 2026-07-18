import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AccountProfile,
  AchievementSummary,
  GameRecord,
  SiteSnapshot,
  StoreMetadata
} from "../../src/types/library";
import type { SteamProfile } from "../../src/types/steam";
import {
  canonicalIdForGame,
  emptyStore,
  type CanonicalAliases
} from "../../src/utils/library";
import { assembleSnapshot, type ProviderSnapshot } from "./assemble-snapshot";
import { mapConcurrent } from "./concurrency";
import { assertSiteSnapshot } from "./schema";
import { SteamClient, type OwnedGame } from "./steam-client";
import { StoreCache } from "./store-cache";

export interface BuildSnapshotOptions {
  client: SteamClient;
  steamUser: string;
  storeCache: StoreCache;
  aliases?: CanonicalAliases;
  now?: () => Date;
}

function accountProfile(profile: SteamProfile): AccountProfile {
  const result: AccountProfile = {
    externalId: profile.steamId,
    displayName: profile.personaName,
    profileUrl: profile.profileUrl
  };
  if (profile.avatarUrl) result.avatarUrl = profile.avatarUrl;
  return result;
}

function toGame(
  owned: OwnedGame,
  achievements: AchievementSummary,
  store: StoreMetadata | undefined,
  aliases: CanonicalAliases
): GameRecord {
  const externalId = String(owned.appId);
  const playtime: GameRecord["playtime"] = {
    totalMinutes: owned.foreverMinutes,
    recentMinutes: owned.recentMinutes
  };
  if (owned.windowsMinutes !== undefined) playtime.windowsMinutes = owned.windowsMinutes;
  if (owned.macMinutes !== undefined) playtime.macMinutes = owned.macMinutes;
  if (owned.linuxMinutes !== undefined) playtime.linuxMinutes = owned.linuxMinutes;
  if (owned.deckMinutes !== undefined) playtime.deckMinutes = owned.deckMinutes;

  const game: GameRecord = {
    id: `steam:${externalId}`,
    canonicalId: canonicalIdForGame("steam", externalId, owned.name, aliases),
    source: "steam",
    externalId,
    name: owned.name,
    ownership: "owned",
    playtime,
    achievements,
    store: store ?? emptyStore(),
    links: {
      store: `https://store.steampowered.com/app/${owned.appId}/`,
      community: `https://steamcommunity.com/app/${owned.appId}/`
    }
  };
  if (owned.iconHash) {
    game.iconUrl = `https://media.steampowered.com/steamcommunity/public/images/apps/${owned.appId}/${owned.iconHash}.jpg`;
  }
  if (owned.lastPlayedUnix) game.lastPlayedAt = new Date(owned.lastPlayedUnix * 1_000).toISOString();
  return game;
}

export async function buildSteamProvider(options: BuildSnapshotOptions): Promise<ProviderSnapshot> {
  const now = options.now ?? (() => new Date());
  const syncedAt = now().toISOString();
  const aliases = options.aliases ?? {};
  const steamId = await options.client.resolveSteamId(options.steamUser);
  const profile = await options.client.getProfile(steamId);
  const ownedResult = await options.client.getOwnedGames(steamId);
  const profileData = accountProfile(profile);

  if (ownedResult.visibility === "private") {
    return {
      account: {
        source: "steam",
        status: "private",
        profile: profileData,
        lastSyncedAt: syncedAt,
        message: "Steam 游戏详情未公开"
      },
      games: []
    };
  }

  const played = ownedResult.games
    .filter((game) => game.foreverMinutes > 0)
    .sort((left, right) => left.appId - right.appId);

  if (played.length === 0) {
    return {
      account: {
        source: "steam",
        status: "empty",
        profile: profileData,
        lastSyncedAt: syncedAt
      },
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
    return toGame(owned, achievement, storeMetadata[index], aliases);
  });

  return {
    account: {
      source: "steam",
      status: "ready",
      profile: profileData,
      lastSyncedAt: syncedAt
    },
    games
  };
}

/** Backwards-compatible entry point: builds a complete v2 snapshot with Steam configured. */
export async function buildSiteSnapshot(options: BuildSnapshotOptions): Promise<SiteSnapshot> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const steam = await buildSteamProvider({ ...options, now: () => new Date(generatedAt) });
  return assembleSnapshot([steam], generatedAt);
}

export function writeSnapshot(path: string, snapshot: SiteSnapshot): void {
  assertSiteSnapshot(snapshot);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}
