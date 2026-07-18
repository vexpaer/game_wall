import { HttpError, requestJson, type FetchLike, type Sleep } from "./http";

const OPENXBL_API_ROOT = "https://api.xbl.io/api/v2/";
const XUID_PATTERN = /^\d{1,20}$/u;
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/u;
const UINT32_MAX = 4_294_967_295;

type UnknownRecord = Record<string, unknown>;

export interface OpenXblAccount {
  xuid: string;
  gamertag: string;
  gamerscore: number;
  avatarUrl?: string;
  accountTier?: string;
}

export interface OpenXblAchievementSummary {
  unlocked: number;
  total: number;
  earnedGamerscore: number;
  totalGamerscore: number;
  percentage: number;
}

export interface OpenXblTitle {
  titleId: string;
  name: string;
  type: string;
  devices: string[];
  imageUrl?: string;
  lastPlayedAt?: string;
  achievements?: OpenXblAchievementSummary;
}

export type OpenXblAchievementProgressState =
  | "Achieved"
  | "InProgress"
  | "NotStarted"
  | "Unknown";

export interface OpenXblAchievement {
  id: string;
  name: string;
  description: string;
  lockedDescription: string;
  progressState: OpenXblAchievementProgressState;
  unlocked: boolean;
  gamerscore: number;
  isSecret: boolean;
  isRevoked: boolean;
  platforms: string[];
  iconUrl?: string;
  unlockedAt?: string;
}

export interface OpenXblAchievementsResult extends OpenXblAchievementSummary {
  titleId: string;
  achievements: OpenXblAchievement[];
  continuationToken?: string;
  totalRecords?: number;
}

export interface OpenXblClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  sleep?: Sleep;
  timeoutMs?: number;
  retries?: number;
}

/**
 * A deliberately small, sanitized request error. It never retains the response
 * payload, the injected fetch error, or a cause that could contain credentials.
 */
export class OpenXblError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenXblError";
    this.status = status;
  }
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} 必须是对象`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} 必须是数组`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new TypeError(`${path} 必须是字符串`);
  return value;
}

function nonEmptyText(value: unknown, path: string): string {
  const result = text(value, path).trim();
  if (!result) throw new TypeError(`${path} 不能为空`);
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} 必须是布尔值`);
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
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new TypeError(`${path} 必须是非负安全整数`);
  }
  return result;
}

function numericStringOrNumber(value: unknown, path: string): number {
  if (typeof value === "number") return nonNegativeInteger(value, path);
  const source = text(value, path);
  if (!UNSIGNED_INTEGER_PATTERN.test(source)) {
    throw new TypeError(`${path} 必须是无符号十进制整数`);
  }
  const result = Number(source);
  if (!Number.isSafeInteger(result)) throw new TypeError(`${path} 超出安全整数范围`);
  return result;
}

function percentage(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (result < 0 || result > 100) throw new TypeError(`${path} 必须介于 0 和 100 之间`);
  return result;
}

function canonicalTitleId(value: unknown, path: string): string {
  const result = numericStringOrNumber(value, path);
  if (result > UINT32_MAX) throw new TypeError(`${path} 必须是 32 位无符号整数`);
  return String(result);
}

function canonicalXuid(value: unknown, path: string): string {
  const result = text(value, path);
  if (!XUID_PATTERN.test(result)) throw new TypeError(`${path} 必须是有效的 XUID`);
  return result;
}

function stringList(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => nonEmptyText(item, `${path}[${index}]`));
}

function safeHttpsUrl(value: unknown, path: string): string {
  const source = nonEmptyText(value, path);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new TypeError(`${path} 必须是有效 URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new TypeError(`${path} 必须是 HTTP(S) URL`);
  }
  if (url.username || url.password) throw new TypeError(`${path} 不得包含 URL 凭据`);
  url.protocol = "https:";
  return url.toString();
}

function isoTimestamp(value: unknown, path: string): string {
  const source = nonEmptyText(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T/iu.test(source) || !/(?:Z|[+-]\d{2}:\d{2})$/iu.test(source)) {
    throw new TypeError(`${path} 必须是带时区的 ISO 时间`);
  }
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${path} 必须是有效时间`);
  return new Date(milliseconds).toISOString();
}

function settingMap(value: unknown, path: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const [index, rawSetting] of array(value, path).entries()) {
    const setting = record(rawSetting, `${path}[${index}]`);
    const id = nonEmptyText(setting.id, `${path}[${index}].id`);
    const settingValue = text(setting.value, `${path}[${index}].value`);
    if (result.has(id)) throw new TypeError(`${path} 包含重复设置 ${id}`);
    result.set(id, settingValue);
  }
  return result;
}

function requiredSetting(settings: Map<string, string>, id: string): string {
  const value = settings.get(id);
  if (value === undefined) throw new TypeError(`account.settings 缺少 ${id}`);
  return value;
}

function parseAccount(payload: unknown): OpenXblAccount {
  const root = record(payload, "account");
  const users = array(root.profileUsers, "account.profileUsers");
  if (users.length !== 1) throw new TypeError("account.profileUsers 必须恰好包含一个用户");
  const profile = record(users[0], "account.profileUsers[0]");
  const settings = settingMap(profile.settings, "account.profileUsers[0].settings");

  const result: OpenXblAccount = {
    xuid: canonicalXuid(profile.id, "account.profileUsers[0].id"),
    gamertag: nonEmptyText(requiredSetting(settings, "Gamertag"), "account.settings.Gamertag"),
    gamerscore: numericStringOrNumber(
      requiredSetting(settings, "Gamerscore"),
      "account.settings.Gamerscore"
    )
  };
  const avatar = settings.get("GameDisplayPicRaw");
  if (avatar?.trim()) result.avatarUrl = safeHttpsUrl(avatar, "account.settings.GameDisplayPicRaw");
  const tier = settings.get("AccountTier")?.trim();
  if (tier) result.accountTier = tier;
  return result;
}

function parseTitleAchievement(value: unknown, path: string): OpenXblAchievementSummary {
  const achievement = record(value, path);
  const unlocked = nonNegativeInteger(achievement.currentAchievements, `${path}.currentAchievements`);
  const total = nonNegativeInteger(achievement.totalAchievements, `${path}.totalAchievements`);
  const earnedGamerscore = nonNegativeInteger(
    achievement.currentGamerscore,
    `${path}.currentGamerscore`
  );
  const totalGamerscore = nonNegativeInteger(achievement.totalGamerscore, `${path}.totalGamerscore`);
  if (unlocked > total) throw new TypeError(`${path}.currentAchievements 不得大于 totalAchievements`);
  if (earnedGamerscore > totalGamerscore) {
    throw new TypeError(`${path}.currentGamerscore 不得大于 totalGamerscore`);
  }
  return {
    unlocked,
    total,
    earnedGamerscore,
    totalGamerscore,
    percentage: percentage(achievement.progressPercentage, `${path}.progressPercentage`)
  };
}

function parseTitleHistory(payload: unknown, expectedXuid: string): OpenXblTitle[] {
  const root = record(payload, "titleHistory");
  const returnedXuid = canonicalXuid(root.xuid, "titleHistory.xuid");
  if (returnedXuid !== expectedXuid) throw new TypeError("titleHistory.xuid 与请求的 XUID 不匹配");

  const seen = new Set<string>();
  return array(root.titles, "titleHistory.titles").map((rawTitle, index): OpenXblTitle => {
    const path = `titleHistory.titles[${index}]`;
    const title = record(rawTitle, path);
    const titleId = canonicalTitleId(title.titleId, `${path}.titleId`);
    if (seen.has(titleId)) throw new TypeError(`titleHistory.titles 包含重复 titleId ${titleId}`);
    seen.add(titleId);

    const result: OpenXblTitle = {
      titleId,
      name: nonEmptyText(title.name, `${path}.name`),
      type: nonEmptyText(title.type, `${path}.type`),
      devices: stringList(title.devices, `${path}.devices`)
    };
    if (title.displayImage !== undefined && title.displayImage !== null) {
      result.imageUrl = safeHttpsUrl(title.displayImage, `${path}.displayImage`);
    }
    if (title.titleHistory !== undefined && title.titleHistory !== null) {
      const history = record(title.titleHistory, `${path}.titleHistory`);
      if (history.lastTimePlayed !== undefined && history.lastTimePlayed !== null) {
        result.lastPlayedAt = isoTimestamp(history.lastTimePlayed, `${path}.titleHistory.lastTimePlayed`);
      }
    }
    if (title.achievement !== undefined && title.achievement !== null) {
      result.achievements = parseTitleAchievement(title.achievement, `${path}.achievement`);
    }
    return result;
  });
}

function progressState(value: unknown, path: string): OpenXblAchievementProgressState {
  const result = text(value, path);
  if (!["Achieved", "InProgress", "NotStarted", "Unknown"].includes(result)) {
    throw new TypeError(`${path} 是未知的成就进度状态`);
  }
  return result as OpenXblAchievementProgressState;
}

function parseGamerscore(value: unknown, path: string): number {
  let score = 0;
  for (const [index, rawReward] of array(value, path).entries()) {
    const rewardPath = `${path}[${index}]`;
    const reward = record(rawReward, rewardPath);
    const type = nonEmptyText(reward.type, `${rewardPath}.type`);
    if (type === "Gamerscore") {
      score += numericStringOrNumber(reward.value, `${rewardPath}.value`);
      if (!Number.isSafeInteger(score)) throw new TypeError(`${path} 玩家分数总和超出安全整数范围`);
    }
  }
  return score;
}

function parseIcon(value: unknown, path: string): string | undefined {
  let icon: string | undefined;
  for (const [index, rawAsset] of array(value, path).entries()) {
    const assetPath = `${path}[${index}]`;
    const asset = record(rawAsset, assetPath);
    const type = nonEmptyText(asset.type, `${assetPath}.type`);
    const url = safeHttpsUrl(asset.url, `${assetPath}.url`);
    if (type === "Icon" && icon === undefined) icon = url;
  }
  return icon;
}

function parsePlatforms(achievement: UnknownRecord, path: string): string[] {
  if (achievement.platforms !== undefined) {
    return stringList(achievement.platforms, `${path}.platforms`);
  }
  if (achievement.platform !== undefined) {
    return [nonEmptyText(achievement.platform, `${path}.platform`)];
  }
  throw new TypeError(`${path} 缺少 platform/platforms`);
}

function validateTitleAssociations(value: unknown, path: string): void {
  const associations = array(value, path);
  if (associations.length === 0) throw new TypeError(`${path} 不能为空`);
  for (const [index, rawAssociation] of associations.entries()) {
    const associationPath = `${path}[${index}]`;
    const association = record(rawAssociation, associationPath);
    canonicalTitleId(association.id, `${associationPath}.id`);
    nonEmptyText(association.name, `${associationPath}.name`);
  }
}

function parseAchievement(value: unknown, path: string): OpenXblAchievement {
  const achievement = record(value, path);
  validateTitleAssociations(achievement.titleAssociations, `${path}.titleAssociations`);
  const state = progressState(achievement.progressState, `${path}.progressState`);
  const revoked = boolean(achievement.isRevoked, `${path}.isRevoked`);
  const progression = record(achievement.progression, `${path}.progression`);
  const result: OpenXblAchievement = {
    id: nonEmptyText(achievement.id, `${path}.id`),
    name: nonEmptyText(achievement.name, `${path}.name`),
    description: text(achievement.description, `${path}.description`),
    lockedDescription: text(achievement.lockedDescription, `${path}.lockedDescription`),
    progressState: state,
    unlocked: state === "Achieved" && !revoked,
    gamerscore: parseGamerscore(achievement.rewards, `${path}.rewards`),
    isSecret: boolean(achievement.isSecret, `${path}.isSecret`),
    isRevoked: revoked,
    platforms: parsePlatforms(achievement, path)
  };
  const icon = parseIcon(achievement.mediaAssets, `${path}.mediaAssets`);
  if (icon) result.iconUrl = icon;
  if (progression.timeUnlocked !== undefined && progression.timeUnlocked !== null) {
    result.unlockedAt = isoTimestamp(progression.timeUnlocked, `${path}.progression.timeUnlocked`);
  }
  return result;
}

function parseAchievements(payload: unknown, titleId: string): OpenXblAchievementsResult {
  const root = record(payload, "achievements");
  const achievements = array(root.achievements, "achievements.achievements").map(
    (achievement, index) => parseAchievement(achievement, `achievements.achievements[${index}]`)
  );
  const ids = new Set<string>();
  for (const achievement of achievements) {
    if (ids.has(achievement.id)) throw new TypeError(`achievements 包含重复 id ${achievement.id}`);
    ids.add(achievement.id);
  }

  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
  const total = achievements.length;
  const earnedGamerscore = achievements.reduce(
    (sum, achievement) => sum + (achievement.unlocked ? achievement.gamerscore : 0),
    0
  );
  const totalGamerscore = achievements.reduce((sum, achievement) => sum + achievement.gamerscore, 0);
  const result: OpenXblAchievementsResult = {
    titleId,
    achievements,
    unlocked,
    total,
    earnedGamerscore,
    totalGamerscore,
    percentage: total === 0 ? 0 : Math.round((unlocked / total) * 10_000) / 100
  };

  if (root.pagingInfo !== undefined && root.pagingInfo !== null) {
    const paging = record(root.pagingInfo, "achievements.pagingInfo");
    if (paging.continuationToken !== undefined && paging.continuationToken !== null) {
      result.continuationToken = nonEmptyText(
        paging.continuationToken,
        "achievements.pagingInfo.continuationToken"
      );
    }
    if (paging.totalRecords !== undefined) {
      const totalRecords = nonNegativeInteger(
        paging.totalRecords,
        "achievements.pagingInfo.totalRecords"
      );
      if (totalRecords < achievements.length) {
        throw new TypeError("achievements.pagingInfo.totalRecords 不得小于当前返回数量");
      }
      result.totalRecords = totalRecords;
    }
  }
  return result;
}

function statusFromError(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof HttpError) return current.status;
    if (!(current instanceof Error)) return undefined;
    current = current.cause;
  }
  return undefined;
}

export class OpenXblClient {
  private readonly apiKey: string;
  private readonly fetch: FetchLike | undefined;
  private readonly sleep: Sleep | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: OpenXblClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new Error("OPENXBL_API_KEY 不能为空");
    if (/[\r\n]/u.test(apiKey)) throw new Error("OPENXBL_API_KEY 格式无效");
    this.apiKey = apiKey;
    this.fetch = options.fetch;
    this.sleep = options.sleep;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 3;
  }

  private async get(relativePath: string): Promise<unknown> {
    const options: Parameters<typeof requestJson>[1] = {
      headers: {
        Accept: "application/json",
        "X-Authorization": this.apiKey
      },
      timeoutMs: this.timeoutMs,
      retries: this.retries
    };
    if (this.fetch !== undefined) options.fetch = this.fetch;
    if (this.sleep !== undefined) options.sleep = this.sleep;

    try {
      return await requestJson(new URL(relativePath, OPENXBL_API_ROOT), options);
    } catch (error) {
      const status = statusFromError(error);
      const suffix = status === undefined ? "" : `（HTTP ${status}）`;
      // Do not attach `error` as a cause: custom fetch errors and response
      // payloads are untrusted and may contain the credential sent in a header.
      throw new OpenXblError(`OpenXBL 请求失败${suffix}`, status);
    }
  }

  private invalidResponse(error: unknown): never {
    const unsafeMessage = error instanceof Error ? error.message : "OpenXBL 响应校验失败";
    const safeMessage = unsafeMessage.split(this.apiKey).join("[REDACTED]");
    // Rebuild the error without a cause or custom properties. Besides making
    // validation failures predictable, this prevents an echoed credential in
    // an untrusted response from surviving on the thrown object.
    if (error instanceof TypeError) throw new TypeError(safeMessage);
    throw new Error(safeMessage);
  }

  async getAccount(): Promise<OpenXblAccount> {
    const payload = await this.get("account");
    try {
      return parseAccount(payload);
    } catch (error) {
      return this.invalidResponse(error);
    }
  }

  async getTitleHistory(xuid: string): Promise<OpenXblTitle[]> {
    const canonical = canonicalXuid(xuid, "xuid");
    const payload = await this.get(`player/titleHistory/${encodeURIComponent(canonical)}`);
    try {
      return parseTitleHistory(payload, canonical);
    } catch (error) {
      return this.invalidResponse(error);
    }
  }

  async getAchievements(
    xuid: string,
    titleId: string | number
  ): Promise<OpenXblAchievementsResult> {
    const canonicalUser = canonicalXuid(xuid, "xuid");
    const canonicalTitle = canonicalTitleId(titleId, "titleId");
    const payload = await this.get(
      `achievements/player/${encodeURIComponent(canonicalUser)}/${encodeURIComponent(canonicalTitle)}`
    );
    try {
      return parseAchievements(payload, canonicalTitle);
    } catch (error) {
      return this.invalidResponse(error);
    }
  }
}
