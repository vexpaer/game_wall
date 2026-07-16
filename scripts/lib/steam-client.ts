import type {
  AchievementSummary,
  SteamProfile,
  StoreMetadata
} from "../../src/types/steam";
import { HttpError, requestJson, type FetchLike, type Sleep } from "./http";

const WEB_API_ROOT = "https://api.steampowered.com";
const STORE_API_ROOT = "https://store.steampowered.com/api/appdetails";
const STEAM_ID_PATTERN = /^\d{17}$/u;

export interface OwnedGame {
  appId: number;
  name: string;
  iconHash?: string;
  foreverMinutes: number;
  recentMinutes: number;
  windowsMinutes?: number;
  macMinutes?: number;
  linuxMinutes?: number;
  deckMinutes?: number;
  lastPlayedUnix?: number;
}

export type OwnedGamesResult =
  | { visibility: "private" }
  | { visibility: "public"; games: OwnedGame[] };

export interface SteamClientOptions {
  apiKey: string;
  language?: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  timeoutMs?: number;
  retries?: number;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new TypeError(`${path} 必须是字符串`);
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} 必须是有限数字`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (!Number.isInteger(result) || result < 0) throw new TypeError(`${path} 必须是非负整数`);
  return result;
}

function optionalNonNegativeInteger(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : nonNegativeInteger(value, path);
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path);
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} 必须是数组`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

function urlWithQuery(path: string, params: Record<string, string>): URL {
  const url = new URL(path, WEB_API_ROOT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (!url.hostname || (url.protocol !== "http:" && url.protocol !== "https:")) return undefined;
    if (url.username || url.password) return undefined;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};

export function plainTextFromHtml(source: string): string {
  return source
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
      return HTML_ENTITIES[normalized] ?? match;
    })
    .replace(/\s+/gu, " ")
    .trim();
}

function noStatsPayload(payload: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload).toLowerCase();
  } catch {
    return false;
  }
  return ["no stats", "has no stats", "no achievements", "does not have stats"].some((phrase) =>
    serialized.includes(phrase)
  );
}

function emptyAchievements(status: "none" | "unavailable"): AchievementSummary {
  return { status, unlocked: 0, total: 0, percentage: 0 };
}

function parseStoreMetadata(payload: unknown, appId: number): StoreMetadata | undefined {
  const root = record(payload, "appdetails");
  const app = record(root[String(appId)], `appdetails.${appId}`);
  if (typeof app.success !== "boolean") {
    throw new TypeError(`appdetails.${appId}.success 必须是布尔值`);
  }
  if (!app.success) return undefined;
  const data = record(app.data, `appdetails.${appId}.data`);

  const developers = data.developers === undefined
    ? []
    : stringList(data.developers, `appdetails.${appId}.data.developers`);
  const publishers = data.publishers === undefined
    ? []
    : stringList(data.publishers, `appdetails.${appId}.data.publishers`);

  const genres: string[] = [];
  if (data.genres !== undefined) {
    if (!Array.isArray(data.genres)) throw new TypeError("appdetails.data.genres 必须是数组");
    for (const [index, rawGenre] of data.genres.entries()) {
      const genre = record(rawGenre, `appdetails.data.genres[${index}]`);
      genres.push(text(genre.description, `appdetails.data.genres[${index}].description`));
    }
  }

  const platforms: string[] = [];
  if (data.platforms !== undefined) {
    const rawPlatforms = record(data.platforms, "appdetails.data.platforms");
    for (const platform of ["windows", "mac", "linux"] as const) {
      const supported = rawPlatforms[platform];
      if (supported !== undefined && typeof supported !== "boolean") {
        throw new TypeError(`appdetails.data.platforms.${platform} 必须是布尔值`);
      }
      if (supported) platforms.push(platform);
    }
  }

  const screenshots: string[] = [];
  if (data.screenshots !== undefined) {
    if (!Array.isArray(data.screenshots)) throw new TypeError("appdetails.data.screenshots 必须是数组");
    for (const [index, rawScreenshot] of data.screenshots.slice(0, 4).entries()) {
      const screenshot = record(rawScreenshot, `appdetails.data.screenshots[${index}]`);
      const image = safeHttpsUrl(screenshot.path_full) ?? safeHttpsUrl(screenshot.path_thumbnail);
      if (image) screenshots.push(image);
    }
  }

  const result: StoreMetadata = { developers, publishers, genres, platforms, screenshots };
  const type = optionalText(data.type, "appdetails.data.type");
  if (type) result.type = type;
  const description = optionalText(data.short_description, "appdetails.data.short_description");
  if (description) result.shortDescription = plainTextFromHtml(description);
  const header = safeHttpsUrl(data.header_image);
  if (header) result.headerImageUrl = header;
  const background = safeHttpsUrl(data.background);
  if (background) result.backgroundImageUrl = background;

  if (data.release_date !== undefined) {
    const release = record(data.release_date, "appdetails.data.release_date");
    if (release.coming_soon !== undefined && typeof release.coming_soon !== "boolean") {
      throw new TypeError("appdetails.data.release_date.coming_soon 必须是布尔值");
    }
    const date = optionalText(release.date, "appdetails.data.release_date.date");
    if (date) result.releaseDate = date;
  }
  return result;
}

export class SteamClient {
  readonly language: string;
  private readonly apiKey: string;
  private readonly fetch: FetchLike | undefined;
  private readonly sleep: Sleep | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: SteamClientOptions) {
    if (!options.apiKey.trim()) throw new Error("STEAM_API_KEY 不能为空");
    this.apiKey = options.apiKey.trim();
    this.language = options.language?.trim() || "schinese";
    this.fetch = options.fetch;
    this.sleep = options.sleep;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 3;
  }

  private async webApi(path: string, params: Record<string, string>): Promise<unknown> {
    const options: Parameters<typeof requestJson>[1] = {
      headers: { "x-webapi-key": this.apiKey },
      timeoutMs: this.timeoutMs,
      retries: this.retries
    };
    if (this.fetch !== undefined) options.fetch = this.fetch;
    if (this.sleep !== undefined) options.sleep = this.sleep;
    return requestJson(urlWithQuery(path, params), options);
  }

  async resolveSteamId(user: string): Promise<string> {
    const candidate = user.trim();
    if (!candidate) throw new Error("STEAM_USER 不能为空");
    if (STEAM_ID_PATTERN.test(candidate)) return candidate;

    const payload = await this.webApi("/ISteamUser/ResolveVanityURL/v1/", {
      vanityurl: candidate
    });
    const response = record(record(payload, "ResolveVanityURL").response, "ResolveVanityURL.response");
    const success = finiteNumber(response.success, "ResolveVanityURL.response.success");
    if (success !== 1) throw new Error(`无法解析 Steam vanity 名称：${candidate}`);
    const steamId = text(response.steamid, "ResolveVanityURL.response.steamid");
    if (!STEAM_ID_PATTERN.test(steamId)) throw new TypeError("ResolveVanityURL 返回了无效 SteamID64");
    return steamId;
  }

  async getProfile(steamId: string): Promise<SteamProfile> {
    const payload = await this.webApi("/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId });
    const response = record(record(payload, "GetPlayerSummaries").response, "GetPlayerSummaries.response");
    if (!Array.isArray(response.players)) throw new TypeError("GetPlayerSummaries.response.players 必须是数组");
    if (response.players.length !== 1) throw new Error(`没有找到 Steam 用户 ${steamId}`);
    const player = record(response.players[0], "GetPlayerSummaries.response.players[0]");
    const returnedId = text(player.steamid, "player.steamid");
    if (returnedId !== steamId) throw new TypeError("GetPlayerSummaries 返回了不匹配的 SteamID");

    const profileUrl = safeHttpsUrl(player.profileurl);
    if (!profileUrl) throw new TypeError("player.profileurl 必须是安全的 HTTPS URL");
    const result: SteamProfile = {
      steamId,
      personaName: text(player.personaname, "player.personaname"),
      profileUrl
    };
    const avatar = safeHttpsUrl(player.avatarfull) ?? safeHttpsUrl(player.avatarmedium);
    if (avatar) result.avatarUrl = avatar;
    const lastLogoff = optionalNonNegativeInteger(player.lastlogoff, "player.lastlogoff");
    if (lastLogoff && lastLogoff > 0) result.lastLogoffAt = new Date(lastLogoff * 1_000).toISOString();
    return result;
  }

  async getOwnedGames(steamId: string): Promise<OwnedGamesResult> {
    const payload = await this.webApi("/IPlayerService/GetOwnedGames/v1/", {
      steamid: steamId,
      include_appinfo: "true",
      include_played_free_games: "true",
      language: this.language
    });
    const response = record(record(payload, "GetOwnedGames").response, "GetOwnedGames.response");
    if (Object.keys(response).length === 0) return { visibility: "private" };

    const count = nonNegativeInteger(response.game_count, "GetOwnedGames.response.game_count");
    if (response.games === undefined && count === 0) return { visibility: "public", games: [] };
    if (!Array.isArray(response.games)) throw new TypeError("GetOwnedGames.response.games 必须是数组");
    if (response.games.length !== count) {
      throw new TypeError("GetOwnedGames.response.games 数量必须等于 game_count");
    }

    const games = response.games.map((rawGame, index): OwnedGame => {
      const game = record(rawGame, `GetOwnedGames.response.games[${index}]`);
      const result: OwnedGame = {
        appId: nonNegativeInteger(game.appid, `games[${index}].appid`),
        name: text(game.name, `games[${index}].name`),
        foreverMinutes: nonNegativeInteger(game.playtime_forever, `games[${index}].playtime_forever`),
        recentMinutes: optionalNonNegativeInteger(game.playtime_2weeks, `games[${index}].playtime_2weeks`) ?? 0
      };
      const iconHash = optionalText(game.img_icon_url, `games[${index}].img_icon_url`);
      if (iconHash && /^[a-f\d]+$/iu.test(iconHash)) result.iconHash = iconHash;
      const windows = optionalNonNegativeInteger(game.playtime_windows_forever, `games[${index}].playtime_windows_forever`);
      if (windows !== undefined) result.windowsMinutes = windows;
      const mac = optionalNonNegativeInteger(game.playtime_mac_forever, `games[${index}].playtime_mac_forever`);
      if (mac !== undefined) result.macMinutes = mac;
      const linux = optionalNonNegativeInteger(game.playtime_linux_forever, `games[${index}].playtime_linux_forever`);
      if (linux !== undefined) result.linuxMinutes = linux;
      const deck = optionalNonNegativeInteger(game.playtime_deck_forever, `games[${index}].playtime_deck_forever`);
      if (deck !== undefined) result.deckMinutes = deck;
      const played = optionalNonNegativeInteger(game.rtime_last_played, `games[${index}].rtime_last_played`);
      if (played && played > 0) result.lastPlayedUnix = played;
      return result;
    });
    return { visibility: "public", games };
  }

  async getAchievements(steamId: string, appId: number): Promise<AchievementSummary> {
    let payload: unknown;
    try {
      payload = await this.webApi("/ISteamUserStats/GetPlayerAchievements/v1/", {
        steamid: steamId,
        appid: String(appId),
        l: this.language
      });
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof HttpError ? error.cause : error;
      if (
        cause instanceof HttpError &&
        cause.status === 400 &&
        noStatsPayload(cause.payload)
      ) {
        return emptyAchievements("none");
      }
      return emptyAchievements("unavailable");
    }

    try {
      const playerstats = record(record(payload, "GetPlayerAchievements").playerstats, "playerstats");
      if (typeof playerstats.success !== "boolean") throw new TypeError("playerstats.success 必须是布尔值");
      if (!playerstats.success) {
        return noStatsPayload(playerstats) ? emptyAchievements("none") : emptyAchievements("unavailable");
      }
      if (playerstats.achievements === undefined) return emptyAchievements("none");
      if (!Array.isArray(playerstats.achievements)) {
        throw new TypeError("playerstats.achievements 必须是数组");
      }
      if (playerstats.achievements.length === 0) return emptyAchievements("none");

      let unlocked = 0;
      for (const [index, rawAchievement] of playerstats.achievements.entries()) {
        const achievement = record(rawAchievement, `playerstats.achievements[${index}]`);
        const achieved = finiteNumber(achievement.achieved, `achievements[${index}].achieved`);
        if (achieved !== 0 && achieved !== 1) throw new TypeError("achievement.achieved 必须为 0 或 1");
        unlocked += achieved;
      }
      const total = playerstats.achievements.length;
      return {
        status: "available",
        unlocked,
        total,
        percentage: Math.round((unlocked / total) * 10_000) / 100
      };
    } catch {
      return emptyAchievements("unavailable");
    }
  }

  async getStoreMetadata(appId: number): Promise<StoreMetadata | undefined> {
    const url = new URL(STORE_API_ROOT);
    url.searchParams.set("appids", String(appId));
    url.searchParams.set("l", this.language);
    url.searchParams.set("cc", "cn");
    try {
      const options: Parameters<typeof requestJson>[1] = {
        timeoutMs: this.timeoutMs,
        retries: this.retries
      };
      if (this.fetch !== undefined) options.fetch = this.fetch;
      if (this.sleep !== undefined) options.sleep = this.sleep;
      const payload = await requestJson(url, options);
      return parseStoreMetadata(payload, appId);
    } catch {
      return undefined;
    }
  }
}
