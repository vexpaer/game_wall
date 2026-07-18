export const gameSources = ["steam", "xbox", "epic", "switch"] as const;

export type GameSource = (typeof gameSources)[number];
export type SnapshotStatus = "ready" | "partial" | "empty";
export type AccountStatus =
  | "ready"
  | "private"
  | "empty"
  | "not_configured"
  | "unavailable"
  | "needs_rebind";
export type AchievementStatus = "available" | "none" | "unavailable" | "unsupported";
export type OwnershipStatus = "owned" | "played" | "subscription" | "unknown";
export type DatePrecision = "date" | "datetime";

export interface AccountProfile {
  externalId: string;
  displayName: string;
  profileUrl?: string;
  avatarUrl?: string;
  region?: string;
  device?: string;
}

export interface SourceAccount {
  source: GameSource;
  status: AccountStatus;
  profile?: AccountProfile;
  lastSyncedAt?: string;
  message?: string;
}

export interface PlaytimeBreakdown {
  totalMinutes?: number;
  recentMinutes?: number;
  windowsMinutes?: number;
  macMinutes?: number;
  linuxMinutes?: number;
  deckMinutes?: number;
  consoleMinutes?: number;
  handheldMinutes?: number;
}

export interface AchievementSummary {
  status: AchievementStatus;
  unlocked: number;
  total: number;
  percentage: number;
}

export interface StoreMetadata {
  type?: string;
  shortDescription?: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  releaseDate?: string;
  platforms: string[];
  headerImageUrl?: string;
  backgroundImageUrl?: string;
  screenshots: string[];
}

export interface GameLinks {
  store?: string;
  community?: string;
}

/** A single provider's record. These records are never discarded when games are merged. */
export interface GameRecord {
  id: string;
  canonicalId: string;
  source: GameSource;
  externalId: string;
  name: string;
  ownership: OwnershipStatus;
  iconUrl?: string;
  lastPlayedAt?: string;
  lastPlayedPrecision?: DatePrecision;
  playtime: PlaytimeBreakdown;
  achievements: AchievementSummary;
  store: StoreMetadata;
  links: GameLinks;
}

export interface SnapshotSummary {
  uniqueGames: number;
  platformRecords: number;
  playedGames: number;
  knownPlaytimeRecords: number;
  totalMinutes: number;
  recentMinutes: number;
  unlockedAchievements: number;
  totalAchievements: number;
  achievementPercentage: number;
  perfectGames: number;
  sourceCounts: Record<GameSource, number>;
}

export interface SiteSnapshot {
  schemaVersion: 2;
  status: SnapshotStatus;
  generatedAt: string;
  accounts: SourceAccount[];
  summary: SnapshotSummary;
  games: GameRecord[];
}

/** A presentation-only group used by the merged view. */
export interface LibraryGame {
  canonicalId: string;
  name: string;
  records: GameRecord[];
  primary: GameRecord;
  sources: GameSource[];
  iconUrl?: string;
  lastPlayedAt?: string;
  lastPlayedPrecision?: DatePrecision;
  playtime: PlaytimeBreakdown;
  achievements: AchievementSummary;
  store: StoreMetadata;
}
