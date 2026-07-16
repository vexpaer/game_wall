import type {
  AchievementSummary,
  SiteSnapshot,
  SnapshotSummary,
  SteamGame,
  SteamProfile,
  StoreMetadata
} from "../../src/types/steam";

function fail(path: string, expectation: string): never {
  throw new TypeError(`${path} ${expectation}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "必须是对象");
  }
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(`${path}.${key}`, "不是允许的字段");
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "必须是字符串");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = string(value, path);
  if (!result.trim()) fail(path, "不能为空");
  return result;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "必须是有限数字");
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const result = number(value, path);
  if (!Number.isInteger(result) || result < 0) fail(path, "必须是非负整数");
  return result;
}

function optional<T>(
  value: unknown,
  path: string,
  validator: (candidate: unknown, candidatePath: string) => T
): T | undefined {
  return value === undefined ? undefined : validator(value, path);
}

function array<T>(
  value: unknown,
  path: string,
  validator: (candidate: unknown, candidatePath: string) => T
): T[] {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  return value.map((item, index) => validator(item, `${path}[${index}]`));
}

function isoDate(value: unknown, path: string): string {
  const result = string(value, path);
  if (Number.isNaN(Date.parse(result))) fail(path, "必须是 ISO 日期时间");
  return result;
}

function url(value: unknown, path: string, httpsOnly = false): string {
  const result = string(value, path);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    fail(path, "必须是绝对 URL");
  }
  if (httpsOnly && parsed.protocol !== "https:") fail(path, "必须使用 HTTPS");
  return result;
}

function percentage(value: unknown, path: string): number {
  const result = number(value, path);
  if (result < 0 || result > 100) fail(path, "必须在 0 到 100 之间");
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path, string);
}

export function assertStoreMetadata(value: unknown, path = "store"): asserts value is StoreMetadata {
  const item = object(value, path);
  knownKeys(item, path, [
    "type",
    "shortDescription",
    "developers",
    "publishers",
    "genres",
    "releaseDate",
    "platforms",
    "headerImageUrl",
    "backgroundImageUrl",
    "screenshots"
  ]);
  optional(item.type, `${path}.type`, string);
  optional(item.shortDescription, `${path}.shortDescription`, string);
  stringArray(item.developers, `${path}.developers`);
  stringArray(item.publishers, `${path}.publishers`);
  stringArray(item.genres, `${path}.genres`);
  optional(item.releaseDate, `${path}.releaseDate`, string);
  const platforms = stringArray(item.platforms, `${path}.platforms`);
  if (platforms.some((platform) => !["windows", "mac", "linux"].includes(platform))) {
    fail(`${path}.platforms`, "包含未知平台");
  }
  optional(item.headerImageUrl, `${path}.headerImageUrl`, (candidate, candidatePath) =>
    url(candidate, candidatePath, true)
  );
  optional(item.backgroundImageUrl, `${path}.backgroundImageUrl`, (candidate, candidatePath) =>
    url(candidate, candidatePath, true)
  );
  const screenshots = stringArray(item.screenshots, `${path}.screenshots`);
  screenshots.forEach((screenshot, index) => url(screenshot, `${path}.screenshots[${index}]`, true));
  if (screenshots.length > 4) fail(`${path}.screenshots`, "最多只能有 4 项");
}

function assertProfile(value: unknown, path: string): asserts value is SteamProfile {
  const profile = object(value, path);
  knownKeys(profile, path, [
    "steamId",
    "personaName",
    "profileUrl",
    "avatarUrl",
    "lastLogoffAt"
  ]);
  nonEmptyString(profile.steamId, `${path}.steamId`);
  nonEmptyString(profile.personaName, `${path}.personaName`);
  url(profile.profileUrl, `${path}.profileUrl`, true);
  optional(profile.avatarUrl, `${path}.avatarUrl`, (candidate, candidatePath) =>
    url(candidate, candidatePath, true)
  );
  optional(profile.lastLogoffAt, `${path}.lastLogoffAt`, isoDate);
}

function assertAchievements(value: unknown, path: string): asserts value is AchievementSummary {
  const achievements = object(value, path);
  knownKeys(achievements, path, ["status", "unlocked", "total", "percentage"]);
  if (!["available", "none", "unavailable"].includes(string(achievements.status, `${path}.status`))) {
    fail(`${path}.status`, "必须是有效状态");
  }
  const unlocked = nonNegativeInteger(achievements.unlocked, `${path}.unlocked`);
  const total = nonNegativeInteger(achievements.total, `${path}.total`);
  const actualPercentage = percentage(achievements.percentage, `${path}.percentage`);
  if (unlocked > total) fail(path, "已解锁数量不能大于总数");
  if (achievements.status === "available") {
    if (total === 0) fail(path, "available 状态必须至少有一个成就");
    const expectedPercentage = Math.round((unlocked / total) * 10_000) / 100;
    if (actualPercentage !== expectedPercentage) {
      fail(`${path}.percentage`, `必须与 ${unlocked}/${total} 一致`);
    }
  } else if (unlocked !== 0 || total !== 0 || actualPercentage !== 0) {
    fail(path, "非 available 状态的计数与百分比必须为 0");
  }
}

function assertGame(value: unknown, path: string): asserts value is SteamGame {
  const game = object(value, path);
  knownKeys(game, path, [
    "appId",
    "name",
    "iconUrl",
    "storeUrl",
    "communityUrl",
    "lastPlayedAt",
    "playtime",
    "achievements",
    "store"
  ]);
  const appId = nonNegativeInteger(game.appId, `${path}.appId`);
  if (appId < 1) fail(`${path}.appId`, "必须大于 0");
  nonEmptyString(game.name, `${path}.name`);
  optional(game.iconUrl, `${path}.iconUrl`, (candidate, candidatePath) =>
    url(candidate, candidatePath, true)
  );
  url(game.storeUrl, `${path}.storeUrl`, true);
  url(game.communityUrl, `${path}.communityUrl`, true);
  optional(game.lastPlayedAt, `${path}.lastPlayedAt`, isoDate);

  const playtime = object(game.playtime, `${path}.playtime`);
  knownKeys(playtime, `${path}.playtime`, [
    "foreverMinutes",
    "recentMinutes",
    "windowsMinutes",
    "macMinutes",
    "linuxMinutes",
    "deckMinutes"
  ]);
  const forever = nonNegativeInteger(playtime.foreverMinutes, `${path}.playtime.foreverMinutes`);
  if (forever < 1) fail(`${path}.playtime.foreverMinutes`, "必须大于 0");
  nonNegativeInteger(playtime.recentMinutes, `${path}.playtime.recentMinutes`);
  for (const platform of ["windowsMinutes", "macMinutes", "linuxMinutes", "deckMinutes"] as const) {
    optional(playtime[platform], `${path}.playtime.${platform}`, nonNegativeInteger);
  }

  assertAchievements(game.achievements, `${path}.achievements`);
  assertStoreMetadata(game.store, `${path}.store`);
}

function assertSummary(value: unknown, path: string): asserts value is SnapshotSummary {
  const summary = object(value, path);
  knownKeys(summary, path, [
    "playedGames",
    "totalMinutes",
    "recentMinutes",
    "unlockedAchievements",
    "totalAchievements",
    "achievementPercentage",
    "perfectGames"
  ]);
  for (const field of [
    "playedGames",
    "totalMinutes",
    "recentMinutes",
    "unlockedAchievements",
    "totalAchievements",
    "perfectGames"
  ] as const) {
    nonNegativeInteger(summary[field], `${path}.${field}`);
  }
  percentage(summary.achievementPercentage, `${path}.achievementPercentage`);
}

export function assertSiteSnapshot(value: unknown): asserts value is SiteSnapshot {
  const snapshot = object(value, "snapshot");
  knownKeys(snapshot, "snapshot", [
    "schemaVersion",
    "status",
    "generatedAt",
    "steamId",
    "profile",
    "summary",
    "games"
  ]);
  if (snapshot.schemaVersion !== 1) fail("snapshot.schemaVersion", "必须为 1");
  const status = string(snapshot.status, "snapshot.status");
  if (!["ready", "private", "empty"].includes(status)) {
    fail("snapshot.status", "必须是 ready、private 或 empty");
  }
  isoDate(snapshot.generatedAt, "snapshot.generatedAt");
  if (!/^\d{17}$/u.test(nonEmptyString(snapshot.steamId, "snapshot.steamId"))) {
    fail("snapshot.steamId", "必须是 17 位 SteamID64");
  }
  if (snapshot.profile !== null) {
    assertProfile(snapshot.profile, "snapshot.profile");
    if ((snapshot.profile as SteamProfile).steamId !== snapshot.steamId) {
      fail("snapshot.profile.steamId", "必须与 snapshot.steamId 一致");
    }
  }
  assertSummary(snapshot.summary, "snapshot.summary");
  const games = array(snapshot.games, "snapshot.games", (game, gamePath) => {
    assertGame(game, gamePath);
    return game;
  });

  if (status !== "ready" && games.length !== 0) fail("snapshot.games", "非 ready 状态必须为空");
  if (status === "ready" && games.length === 0) fail("snapshot.games", "ready 状态至少需要一个游戏");
  if ((snapshot.summary as SnapshotSummary).playedGames !== games.length) {
    fail("snapshot.summary.playedGames", "必须等于 games 数量");
  }

  const expectedSummary: SnapshotSummary = {
    playedGames: games.length,
    totalMinutes: games.reduce((sum, game) => sum + game.playtime.foreverMinutes, 0),
    recentMinutes: games.reduce((sum, game) => sum + game.playtime.recentMinutes, 0),
    unlockedAchievements: games.reduce(
      (sum, game) => sum + (game.achievements.status === "available" ? game.achievements.unlocked : 0),
      0
    ),
    totalAchievements: games.reduce(
      (sum, game) => sum + (game.achievements.status === "available" ? game.achievements.total : 0),
      0
    ),
    achievementPercentage: 0,
    perfectGames: games.filter(
      (game) =>
        game.achievements.status === "available" &&
        game.achievements.total > 0 &&
        game.achievements.unlocked === game.achievements.total
    ).length
  };
  expectedSummary.achievementPercentage = expectedSummary.totalAchievements === 0
    ? 0
    : Math.round(
        (expectedSummary.unlockedAchievements / expectedSummary.totalAchievements) * 10_000
      ) / 100;

  const actualSummary = snapshot.summary as SnapshotSummary;
  for (const field of Object.keys(expectedSummary) as (keyof SnapshotSummary)[]) {
    if (actualSummary[field] !== expectedSummary[field]) {
      fail(`snapshot.summary.${field}`, `必须由 games 重新计算为 ${expectedSummary[field]}`);
    }
  }
  for (let index = 1; index < games.length; index += 1) {
    const previous = games[index - 1];
    const current = games[index];
    if (previous !== undefined && current !== undefined && previous.appId >= current.appId) {
      fail("snapshot.games", "必须按 appId 严格升序排列");
    }
  }
}

export function parseSiteSnapshot(value: unknown): SiteSnapshot {
  assertSiteSnapshot(value);
  return value;
}
