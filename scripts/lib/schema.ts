import type {
  AchievementSummary,
  GameRecord,
  SiteSnapshot,
  SnapshotSummary,
  SourceAccount,
  StoreMetadata
} from "../../src/types/library";
import { gameSources } from "../../src/types/library";
import {
  hasAmbiguousSameSourceTitleCollision,
  snapshotStatus,
  summarizeLibrary
} from "../../src/utils/library";

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

function text(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "必须是字符串");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = text(value, path);
  if (!result.trim()) fail(path, "不能为空");
  return result;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "必须是有限数字");
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
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
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) fail(path, "必须是 ISO 日期时间");
  return result;
}

function httpsUrl(value: unknown, path: string): string {
  const result = text(value, path);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    fail(path, "必须是绝对 URL");
  }
  if (parsed.protocol !== "https:") fail(path, "必须使用 HTTPS");
  return result;
}

function percentage(value: unknown, path: string): number {
  const result = finiteNumber(value, path);
  if (result < 0 || result > 100) fail(path, "必须在 0 到 100 之间");
  return result;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path, text);
}

function enumValue<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const result = text(value, path);
  if (!allowed.includes(result as T)) fail(path, `必须是 ${allowed.join("、")} 之一`);
  return result as T;
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
  optional(item.type, `${path}.type`, text);
  optional(item.shortDescription, `${path}.shortDescription`, text);
  stringArray(item.developers, `${path}.developers`);
  stringArray(item.publishers, `${path}.publishers`);
  stringArray(item.genres, `${path}.genres`);
  optional(item.releaseDate, `${path}.releaseDate`, text);
  stringArray(item.platforms, `${path}.platforms`);
  optional(item.headerImageUrl, `${path}.headerImageUrl`, httpsUrl);
  optional(item.backgroundImageUrl, `${path}.backgroundImageUrl`, httpsUrl);
  const screenshots = stringArray(item.screenshots, `${path}.screenshots`);
  screenshots.forEach((url, index) => httpsUrl(url, `${path}.screenshots[${index}]`));
  if (screenshots.length > 4) fail(`${path}.screenshots`, "最多只能有 4 项");
}

function assertAchievements(value: unknown, path: string): asserts value is AchievementSummary {
  const achievements = object(value, path);
  knownKeys(achievements, path, ["status", "unlocked", "total", "percentage"]);
  const status = enumValue(achievements.status, `${path}.status`, [
    "available",
    "none",
    "unavailable",
    "unsupported"
  ] as const);
  const unlocked = nonNegativeInteger(achievements.unlocked, `${path}.unlocked`);
  const total = nonNegativeInteger(achievements.total, `${path}.total`);
  const actualPercentage = percentage(achievements.percentage, `${path}.percentage`);
  if (unlocked > total) fail(path, "已解锁数量不能大于总数");
  if (status === "available") {
    if (total === 0) fail(path, "available 状态必须至少有一个成就");
    const expectedPercentage = Math.round((unlocked / total) * 10_000) / 100;
    if (actualPercentage !== expectedPercentage) {
      fail(`${path}.percentage`, `必须与 ${unlocked}/${total} 一致`);
    }
  } else if (unlocked !== 0 || total !== 0 || actualPercentage !== 0) {
    fail(path, "非 available 状态的计数与百分比必须为 0");
  }
}

function assertAccount(value: unknown, path: string): SourceAccount {
  const account = object(value, path);
  knownKeys(account, path, ["source", "status", "profile", "lastSyncedAt", "message"]);
  enumValue(account.source, `${path}.source`, gameSources);
  enumValue(account.status, `${path}.status`, [
    "ready",
    "private",
    "empty",
    "not_configured",
    "unavailable",
    "needs_rebind"
  ] as const);
  if (account.profile !== undefined) {
    const profile = object(account.profile, `${path}.profile`);
    knownKeys(profile, `${path}.profile`, [
      "externalId",
      "displayName",
      "profileUrl",
      "avatarUrl",
      "region",
      "device"
    ]);
    nonEmptyString(profile.externalId, `${path}.profile.externalId`);
    nonEmptyString(profile.displayName, `${path}.profile.displayName`);
    optional(profile.profileUrl, `${path}.profile.profileUrl`, httpsUrl);
    optional(profile.avatarUrl, `${path}.profile.avatarUrl`, httpsUrl);
    optional(profile.region, `${path}.profile.region`, nonEmptyString);
    optional(profile.device, `${path}.profile.device`, nonEmptyString);
  }
  optional(account.lastSyncedAt, `${path}.lastSyncedAt`, isoDate);
  optional(account.message, `${path}.message`, nonEmptyString);
  return value as SourceAccount;
}

function assertGame(value: unknown, path: string): GameRecord {
  const game = object(value, path);
  knownKeys(game, path, [
    "id",
    "canonicalId",
    "source",
    "externalId",
    "name",
    "ownership",
    "iconUrl",
    "lastPlayedAt",
    "lastPlayedPrecision",
    "playtime",
    "achievements",
    "store",
    "links"
  ]);
  const source = enumValue(game.source, `${path}.source`, gameSources);
  const externalId = nonEmptyString(game.externalId, `${path}.externalId`);
  const id = nonEmptyString(game.id, `${path}.id`);
  if (id !== `${source}:${externalId}`) fail(`${path}.id`, `必须等于 ${source}:${externalId}`);
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/u.test(nonEmptyString(game.canonicalId, `${path}.canonicalId`))) {
    fail(`${path}.canonicalId`, "必须是规范化标题与 8 位哈希组成的安全 ID");
  }
  nonEmptyString(game.name, `${path}.name`);
  enumValue(game.ownership, `${path}.ownership`, ["owned", "played", "subscription", "unknown"] as const);
  optional(game.iconUrl, `${path}.iconUrl`, httpsUrl);
  optional(game.lastPlayedAt, `${path}.lastPlayedAt`, isoDate);
  const lastPlayedPrecision = optional(
    game.lastPlayedPrecision,
    `${path}.lastPlayedPrecision`,
    (candidate, candidatePath) => enumValue(candidate, candidatePath, ["date", "datetime"] as const)
  );
  if (lastPlayedPrecision !== undefined && game.lastPlayedAt === undefined) {
    fail(`${path}.lastPlayedPrecision`, "只能与 lastPlayedAt 同时出现");
  }

  const playtime = object(game.playtime, `${path}.playtime`);
  const playtimeFields = [
    "totalMinutes",
    "recentMinutes",
    "windowsMinutes",
    "macMinutes",
    "linuxMinutes",
    "deckMinutes",
    "consoleMinutes",
    "handheldMinutes"
  ] as const;
  knownKeys(playtime, `${path}.playtime`, playtimeFields);
  for (const field of playtimeFields) {
    optional(playtime[field], `${path}.playtime.${field}`, nonNegativeInteger);
  }

  assertAchievements(game.achievements, `${path}.achievements`);
  assertStoreMetadata(game.store, `${path}.store`);
  const links = object(game.links, `${path}.links`);
  knownKeys(links, `${path}.links`, ["store", "community"]);
  optional(links.store, `${path}.links.store`, httpsUrl);
  optional(links.community, `${path}.links.community`, httpsUrl);
  return value as GameRecord;
}

function assertSummaryShape(value: unknown, path: string): SnapshotSummary {
  const summary = object(value, path);
  knownKeys(summary, path, [
    "uniqueGames",
    "platformRecords",
    "playedGames",
    "knownPlaytimeRecords",
    "totalMinutes",
    "recentMinutes",
    "unlockedAchievements",
    "totalAchievements",
    "achievementPercentage",
    "perfectGames",
    "sourceCounts"
  ]);
  for (const field of [
    "uniqueGames",
    "platformRecords",
    "playedGames",
    "knownPlaytimeRecords",
    "totalMinutes",
    "recentMinutes",
    "unlockedAchievements",
    "totalAchievements",
    "perfectGames"
  ] as const) {
    nonNegativeInteger(summary[field], `${path}.${field}`);
  }
  percentage(summary.achievementPercentage, `${path}.achievementPercentage`);
  const counts = object(summary.sourceCounts, `${path}.sourceCounts`);
  knownKeys(counts, `${path}.sourceCounts`, gameSources);
  for (const source of gameSources) nonNegativeInteger(counts[source], `${path}.sourceCounts.${source}`);
  return value as SnapshotSummary;
}

function sameSummary(actual: SnapshotSummary, expected: SnapshotSummary): void {
  for (const field of [
    "uniqueGames",
    "platformRecords",
    "playedGames",
    "knownPlaytimeRecords",
    "totalMinutes",
    "recentMinutes",
    "unlockedAchievements",
    "totalAchievements",
    "achievementPercentage",
    "perfectGames"
  ] as const) {
    if (actual[field] !== expected[field]) {
      fail(`snapshot.summary.${field}`, `必须由 games 重新计算为 ${expected[field]}`);
    }
  }
  for (const source of gameSources) {
    if (actual.sourceCounts[source] !== expected.sourceCounts[source]) {
      fail(`snapshot.summary.sourceCounts.${source}`, `必须由 games 重新计算为 ${expected.sourceCounts[source]}`);
    }
  }
}

export function assertSiteSnapshot(value: unknown): asserts value is SiteSnapshot {
  const snapshot = object(value, "snapshot");
  knownKeys(snapshot, "snapshot", ["schemaVersion", "status", "generatedAt", "accounts", "summary", "games"]);
  if (snapshot.schemaVersion !== 2) fail("snapshot.schemaVersion", "必须为 2");
  const status = enumValue(snapshot.status, "snapshot.status", ["ready", "partial", "empty"] as const);
  isoDate(snapshot.generatedAt, "snapshot.generatedAt");
  const accounts = array(snapshot.accounts, "snapshot.accounts", assertAccount);
  if (accounts.length !== gameSources.length) fail("snapshot.accounts", "必须包含全部四个平台");
  accounts.forEach((account, index) => {
    if (account.source !== gameSources[index]) fail("snapshot.accounts", "必须按 steam、xbox、epic、switch 排列");
  });
  const games = array(snapshot.games, "snapshot.games", assertGame);
  const ids = new Set<string>();
  for (const game of games) {
    if (ids.has(game.id)) fail("snapshot.games", `包含重复记录 ${game.id}`);
    ids.add(game.id);
  }
  if (hasAmbiguousSameSourceTitleCollision(games)) {
    fail("snapshot.games", "同一平台存在无法自动区分的同名游戏；请用 aliases.records 显式拆分");
  }
  for (let index = 1; index < games.length; index += 1) {
    const previous = games[index - 1];
    const current = games[index];
    if (!previous || !current) continue;
    const sourceDifference = gameSources.indexOf(previous.source) - gameSources.indexOf(current.source);
    if (sourceDifference > 0 || (sourceDifference === 0 && previous.externalId.localeCompare(current.externalId, "en") >= 0)) {
      fail("snapshot.games", "必须按平台顺序与 externalId 严格升序排列");
    }
  }
  const actualSummary = assertSummaryShape(snapshot.summary, "snapshot.summary");
  sameSummary(actualSummary, summarizeLibrary(games));
  const expectedStatus = snapshotStatus(accounts, games);
  if (status !== expectedStatus) fail("snapshot.status", `必须由 accounts 与 games 重新计算为 ${expectedStatus}`);
}

export function parseSiteSnapshot(value: unknown): SiteSnapshot {
  assertSiteSnapshot(value);
  return value;
}
