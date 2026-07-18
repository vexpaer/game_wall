export type {
  AchievementStatus,
  AchievementSummary,
  PlaytimeBreakdown,
  StoreMetadata
} from "./library";

export interface SteamProfile {
  steamId: string;
  personaName: string;
  profileUrl: string;
  avatarUrl?: string;
  lastLogoffAt?: string;
}
