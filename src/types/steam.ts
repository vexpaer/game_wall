export type SnapshotStatus = "ready" | "private" | "empty";
export type AchievementStatus = "available" | "none" | "unavailable";

export interface SteamProfile {
  steamId: string;
  personaName: string;
  profileUrl: string;
  avatarUrl?: string;
  lastLogoffAt?: string;
}

export interface PlaytimeBreakdown {
  foreverMinutes: number;
  recentMinutes: number;
  windowsMinutes?: number;
  macMinutes?: number;
  linuxMinutes?: number;
  deckMinutes?: number;
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

export interface SteamGame {
  appId: number;
  name: string;
  iconUrl?: string;
  storeUrl: string;
  communityUrl: string;
  lastPlayedAt?: string;
  playtime: PlaytimeBreakdown;
  achievements: AchievementSummary;
  store: StoreMetadata;
}

export interface SnapshotSummary {
  playedGames: number;
  totalMinutes: number;
  recentMinutes: number;
  unlockedAchievements: number;
  totalAchievements: number;
  achievementPercentage: number;
  perfectGames: number;
}

export interface SiteSnapshot {
  schemaVersion: 1;
  status: SnapshotStatus;
  generatedAt: string;
  steamId: string;
  profile: SteamProfile | null;
  summary: SnapshotSummary;
  games: SteamGame[];
}
