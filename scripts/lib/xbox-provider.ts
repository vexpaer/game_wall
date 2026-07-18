import type { GameRecord, SourceAccount } from "../../src/types/library";
import {
  canonicalIdForGame,
  emptyAchievements,
  emptyStore,
  type CanonicalAliases
} from "../../src/utils/library";
import type { ProviderSnapshot } from "./assemble-snapshot";
import type { OpenXblAccount, OpenXblClient, OpenXblTitle } from "./openxbl-client";

export type XboxProviderClient = Pick<OpenXblClient, "getAccount" | "getTitleHistory">;

export interface BuildXboxProviderOptions {
  client: XboxProviderClient;
  aliases?: CanonicalAliases;
  now?: () => Date;
}

function profileUrl(gamertag: string): string {
  const url = new URL("https://account.xbox.com/profile");
  url.searchParams.set("gamertag", gamertag);
  return url.toString();
}

function accountProfile(account: OpenXblAccount): NonNullable<SourceAccount["profile"]> {
  const profile: NonNullable<SourceAccount["profile"]> = {
    externalId: account.xuid,
    displayName: account.gamertag,
    profileUrl: profileUrl(account.gamertag)
  };
  if (account.avatarUrl) profile.avatarUrl = account.avatarUrl;
  return profile;
}

function achievementsForTitle(title: OpenXblTitle): GameRecord["achievements"] {
  const summary = title.achievements;
  if (!summary) return emptyAchievements("unavailable");
  if (summary.total === 0) return emptyAchievements("none");

  return {
    status: "available",
    unlocked: summary.unlocked,
    total: summary.total,
    percentage: Math.round((summary.unlocked / summary.total) * 10_000) / 100
  };
}

function gameForTitle(title: OpenXblTitle, aliases: CanonicalAliases): GameRecord {
  const store = emptyStore();
  store.type = title.type;
  store.platforms = [...new Set(title.devices)];
  if (title.imageUrl) store.headerImageUrl = title.imageUrl;

  const game: GameRecord = {
    id: `xbox:${title.titleId}`,
    canonicalId: canonicalIdForGame("xbox", title.titleId, title.name, aliases),
    source: "xbox",
    externalId: title.titleId,
    name: title.name,
    ownership: "played",
    // OpenXBL title history does not expose a trustworthy playtime value.
    // Keeping this object empty distinguishes "unknown" from a real zero.
    playtime: {},
    achievements: achievementsForTitle(title),
    store,
    links: {}
  };
  if (title.imageUrl) game.iconUrl = title.imageUrl;
  if (title.lastPlayedAt) game.lastPlayedAt = title.lastPlayedAt;
  return game;
}

async function getAccount(client: XboxProviderClient): Promise<OpenXblAccount> {
  try {
    return await client.getAccount();
  } catch {
    // Do not retain a provider/client error or cause: an untrusted implementation
    // could have embedded request credentials in either one.
    throw new Error("Xbox 账户读取失败");
  }
}

async function getTitleHistory(
  client: XboxProviderClient,
  xuid: string
): Promise<OpenXblTitle[]> {
  try {
    return await client.getTitleHistory(xuid);
  } catch {
    throw new Error("Xbox 游戏历史读取失败");
  }
}

export async function buildXboxProvider(
  options: BuildXboxProviderOptions
): Promise<ProviderSnapshot> {
  const syncedAt = (options.now ?? (() => new Date()))().toISOString();
  const aliases = options.aliases ?? {};
  const account = await getAccount(options.client);
  const titles = await getTitleHistory(options.client, account.xuid);
  const games = titles
    .map((title) => gameForTitle(title, aliases))
    .sort((left, right) => left.externalId.localeCompare(right.externalId, "en", { numeric: true }));

  return {
    account: {
      source: "xbox",
      status: games.length === 0 ? "empty" : "ready",
      profile: accountProfile(account),
      lastSyncedAt: syncedAt
    },
    games
  };
}
