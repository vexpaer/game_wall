import type {
  AchievementSummary,
  GameRecord,
  GameSource,
  LibraryGame,
  PlaytimeBreakdown,
  SnapshotStatus,
  SnapshotSummary,
  SourceAccount,
  StoreMetadata
} from "../types/library";
import { gameSources } from "../types/library";

export const sourceLabels: Record<GameSource, string> = {
  steam: "Steam",
  xbox: "Xbox",
  epic: "Epic",
  switch: "Switch"
};

export interface CanonicalAliases {
  records?: Record<string, string>;
  titles?: Record<string, string>;
}

const EMPTY_STORE: StoreMetadata = {
  developers: [],
  publishers: [],
  genres: [],
  platforms: [],
  screenshots: []
};

const EDITION_SUFFIXES = /\b(?:deluxe|complete|ultimate|gold|goty|game of the year)\s+edition\b/giu;

function normalizeTitleText(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeExactGameTitle(title: string): string {
  return normalizeTitleText(title.replace(/[®™©]/gu, ""));
}

export function normalizeGameTitle(title: string): string {
  return normalizeTitleText(title.replace(/[®™©]/gu, "").replace(EDITION_SUFFIXES, " "));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slug(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/gu, "");
  return ascii || "game";
}

export function canonicalIdForGame(
  source: GameSource,
  externalId: string,
  title: string,
  aliases: CanonicalAliases = {}
): string {
  const recordKey = `${source}:${externalId}`;
  const normalized = normalizeGameTitle(title) || recordKey;
  const canonicalTitle = aliases.records?.[recordKey] ?? aliases.titles?.[normalized] ?? normalized;
  const canonicalKey = normalizeGameTitle(canonicalTitle) || canonicalTitle;
  return `${slug(canonicalKey)}-${fnv1a(canonicalKey)}`;
}

export function emptyAchievements(status: AchievementSummary["status"] = "unsupported"): AchievementSummary {
  return { status, unlocked: 0, total: 0, percentage: 0 };
}

export function emptyStore(): StoreMetadata {
  return { ...EMPTY_STORE, developers: [], publishers: [], genres: [], platforms: [], screenshots: [] };
}

function sumKnown(records: readonly GameRecord[], field: keyof PlaytimeBreakdown): number | undefined {
  const values = records
    .map((record) => record.playtime[field])
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function aggregateAchievements(records: readonly GameRecord[]): AchievementSummary {
  const available = records.filter((record) => record.achievements.status === "available");
  if (available.length > 0) {
    const unlocked = available.reduce((sum, record) => sum + record.achievements.unlocked, 0);
    const total = available.reduce((sum, record) => sum + record.achievements.total, 0);
    return {
      status: "available",
      unlocked,
      total,
      percentage: total === 0 ? 0 : Math.round((unlocked / total) * 10_000) / 100
    };
  }
  if (records.some((record) => record.achievements.status === "unavailable")) {
    return emptyAchievements("unavailable");
  }
  if (records.some((record) => record.achievements.status === "none")) {
    return emptyAchievements("none");
  }
  return emptyAchievements("unsupported");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function metadataScore(record: GameRecord): number {
  return (record.store.headerImageUrl ? 8 : 0)
    + (record.store.backgroundImageUrl ? 4 : 0)
    + (record.iconUrl ? 2 : 0)
    + record.store.genres.length
    + record.store.developers.length
    + (record.store.shortDescription ? 2 : 0);
}

function latestActivity(records: readonly GameRecord[]): GameRecord | undefined {
  return records
    .filter((record) => record.lastPlayedAt !== undefined)
    .sort((left, right) => Date.parse(right.lastPlayedAt ?? "") - Date.parse(left.lastPlayedAt ?? ""))[0];
}

function firstDefined<T>(
  records: readonly GameRecord[],
  select: (record: GameRecord) => T | undefined
): T | undefined {
  for (const record of records) {
    const value = select(record);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function mergeGameRecords(records: readonly GameRecord[]): LibraryGame[] {
  const groups = new Map<string, GameRecord[]>();
  for (const record of records) {
    const group = groups.get(record.canonicalId) ?? [];
    group.push(record);
    groups.set(record.canonicalId, group);
  }

  return [...groups.entries()].map(([canonicalId, grouped]) => {
    const sorted = [...grouped].sort((left, right) => {
      const score = metadataScore(right) - metadataScore(left);
      return score || gameSources.indexOf(left.source) - gameSources.indexOf(right.source);
    });
    const primary = sorted[0];
    if (!primary) throw new Error(`游戏组 ${canonicalId} 不能为空`);
    const totalMinutes = sumKnown(grouped, "totalMinutes");
    const recentMinutes = sumKnown(grouped, "recentMinutes");
    const playtime: PlaytimeBreakdown = {};
    if (totalMinutes !== undefined) playtime.totalMinutes = totalMinutes;
    if (recentMinutes !== undefined) playtime.recentMinutes = recentMinutes;

    const store: StoreMetadata = {
      developers: unique(grouped.flatMap((record) => record.store.developers)),
      publishers: unique(grouped.flatMap((record) => record.store.publishers)),
      genres: unique(grouped.flatMap((record) => record.store.genres)),
      platforms: unique(grouped.flatMap((record) => record.store.platforms)),
      screenshots: unique(grouped.flatMap((record) => record.store.screenshots)).slice(0, 4)
    };
    const type = firstDefined(sorted, (record) => record.store.type);
    const shortDescription = firstDefined(sorted, (record) => record.store.shortDescription);
    const releaseDate = firstDefined(sorted, (record) => record.store.releaseDate);
    const headerImageUrl = firstDefined(sorted, (record) => record.store.headerImageUrl);
    const backgroundImageUrl = firstDefined(sorted, (record) => record.store.backgroundImageUrl);
    if (type) store.type = type;
    if (shortDescription) store.shortDescription = shortDescription;
    if (releaseDate) store.releaseDate = releaseDate;
    if (headerImageUrl) store.headerImageUrl = headerImageUrl;
    if (backgroundImageUrl) store.backgroundImageUrl = backgroundImageUrl;

    const result: LibraryGame = {
      canonicalId,
      name: primary.name,
      records: [...grouped].sort((left, right) => gameSources.indexOf(left.source) - gameSources.indexOf(right.source)),
      primary,
      sources: gameSources.filter((source) => grouped.some((record) => record.source === source)),
      playtime,
      achievements: aggregateAchievements(grouped),
      store
    };
    const iconUrl = firstDefined(sorted, (record) => record.iconUrl);
    if (iconUrl) result.iconUrl = iconUrl;
    const latest = latestActivity(grouped);
    if (latest?.lastPlayedAt) {
      result.lastPlayedAt = latest.lastPlayedAt;
      if (latest.lastPlayedPrecision) result.lastPlayedPrecision = latest.lastPlayedPrecision;
    }
    return result;
  }).sort((left, right) => left.canonicalId.localeCompare(right.canonicalId, "en"));
}

export function hasAmbiguousSameSourceTitleCollision(records: readonly GameRecord[]): boolean {
  const seen = new Set<string>();
  for (const record of records) {
    const identity = `${record.source}\0${record.canonicalId}\0${normalizeExactGameTitle(record.name)}`;
    if (seen.has(identity)) return true;
    seen.add(identity);
  }
  return false;
}

export function summarizeLibrary(games: readonly GameRecord[]): SnapshotSummary {
  const merged = mergeGameRecords(games);
  const available = games.filter((game) => game.achievements.status === "available");
  const unlockedAchievements = available.reduce((sum, game) => sum + game.achievements.unlocked, 0);
  const totalAchievements = available.reduce((sum, game) => sum + game.achievements.total, 0);
  const sourceCounts = Object.fromEntries(gameSources.map((source) => [source, 0])) as Record<GameSource, number>;
  for (const game of games) sourceCounts[game.source] += 1;

  return {
    uniqueGames: merged.length,
    platformRecords: games.length,
    playedGames: merged.filter((game) =>
      (game.playtime.totalMinutes ?? 0) > 0 || game.lastPlayedAt !== undefined
      || game.records.some((record) => record.ownership === "played")
    ).length,
    knownPlaytimeRecords: games.filter((game) => game.playtime.totalMinutes !== undefined).length,
    totalMinutes: games.reduce((sum, game) => sum + (game.playtime.totalMinutes ?? 0), 0),
    recentMinutes: games.reduce((sum, game) => sum + (game.playtime.recentMinutes ?? 0), 0),
    unlockedAchievements,
    totalAchievements,
    achievementPercentage:
      totalAchievements === 0
        ? 0
        : Math.round((unlockedAchievements / totalAchievements) * 10_000) / 100,
    perfectGames: merged.filter((game) =>
      game.achievements.status === "available"
      && game.achievements.total > 0
      && game.achievements.unlocked === game.achievements.total
    ).length,
    sourceCounts
  };
}

export function snapshotStatus(accounts: readonly SourceAccount[], games: readonly GameRecord[]): SnapshotStatus {
  const configured = accounts.filter((account) => account.status !== "not_configured");
  if (games.length === 0) return "empty";
  return configured.some((account) => !["ready", "empty"].includes(account.status)) ? "partial" : "ready";
}
