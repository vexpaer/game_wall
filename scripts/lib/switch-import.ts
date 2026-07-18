export const DEFAULT_SWITCH_SYSTEM = "switch" as const;
export const DEFAULT_SWITCH_LOCALE = "ja-JP";

export const switchSystems = ["switch", "switch-2"] as const;
export const switchOwnerships = ["owned", "played", "subscription", "unknown"] as const;

export type SwitchSystem = (typeof switchSystems)[number];
export type SwitchOwnership = (typeof switchOwnerships)[number];
export type SwitchImportFormat = "json" | "csv";

export interface SwitchImportRecord {
  title: string;
  externalId?: string;
  playMinutes?: number;
  firstPlayed?: string;
  lastPlayed?: string;
  system: SwitchSystem;
  ownership: SwitchOwnership;
  coverUrl?: string;
}

export interface SwitchImportBatch {
  locale: string;
  games: SwitchImportRecord[];
}

export interface SwitchImportOptions {
  defaultSystem?: SwitchSystem;
  locale?: string;
}

export type NxapiDailySummaryResult = "ACHIEVED" | "CALCULATING" | "UNACHIEVED";

export interface NxapiParentalDailyGame {
  title: string;
  externalId: string;
  playSeconds: number;
  playMinutes: number;
  firstPlayed: string;
  lastPlayed: string;
  system: SwitchSystem;
  ownership: "played";
  coverUrl?: string;
}

/**
 * Sanitised subset of one `nxapi pctl` daily summary. It deliberately contains
 * no player name, Nintendo Account identifier, session token, or raw payload.
 */
export interface NxapiParentalDailySummary {
  deviceId: string;
  date: string;
  result: NxapiDailySummaryResult;
  complete: boolean;
  updatedAt: number;
  totalPlayingSeconds: number;
  locale: string;
  system: SwitchSystem;
  games: NxapiParentalDailyGame[];
}

const MANUAL_FIELDS = [
  "title",
  "externalId",
  "playMinutes",
  "firstPlayed",
  "lastPlayed",
  "system",
  "ownership",
  "coverUrl"
] as const;
const MANUAL_FIELD_SET = new Set<string>(MANUAL_FIELDS);
const MAX_SOURCE_LENGTH = 5 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const MAX_HISTORY_GAMES = 100_000;
const MAX_TITLE_LENGTH = 300;
const MAX_IDENTIFIER_LENGTH = 128;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/u;
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const APPLICATION_ID = /^[0-9a-f]{16}$/iu;

function fail(path: string, message: string): never {
  throw new TypeError(`${path} ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "必须是对象");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "必须是字符串");
  return value;
}

function cleanString(value: unknown, path: string, maxLength: number): string {
  const result = string(value, path).trim();
  if (!result) fail(path, "不能为空");
  if (result.length > maxLength) fail(path, `不能超过 ${maxLength} 个字符`);
  if (/\p{Cc}/u.test(result)) fail(path, "不能包含控制字符");
  return result;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(path, "必须是非负安全整数");
  }
  return value;
}

function parseDate(value: unknown, path: string, dateOnly = false): string {
  const result = string(value, path);
  if ((!DATE_ONLY.test(result) && (dateOnly || !RFC_3339.test(result))) || Number.isNaN(Date.parse(result))) {
    fail(path, dateOnly ? "必须是 YYYY-MM-DD 日期" : "必须是 YYYY-MM-DD 或带时区的 RFC 3339 日期时间");
  }
  if (DATE_ONLY.test(result)) {
    const parsed = new Date(`${result}T00:00:00.000Z`);
    if (parsed.toISOString().slice(0, 10) !== result) fail(path, "不是有效日历日期");
  }
  return result;
}

function parseHttpsUrl(value: unknown, path: string): string {
  const result = string(value, path);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    fail(path, "必须是绝对 URL");
  }
  if (parsed.protocol !== "https:") fail(path, "必须使用 HTTPS");
  if (parsed.username || parsed.password) fail(path, "不能包含用户名或密码");
  return parsed.toString();
}

function parseApplicationId(value: unknown, path: string): string {
  const result = cleanString(value, path, MAX_IDENTIFIER_LENGTH);
  if (!APPLICATION_ID.test(result)) fail(path, "必须是 16 位十六进制 Switch Application ID");
  return result.toUpperCase();
}

function parseSystem(value: unknown, path: string): SwitchSystem {
  const result = string(value, path);
  if (!switchSystems.includes(result as SwitchSystem)) {
    fail(path, `必须是 ${switchSystems.join(" 或 ")}`);
  }
  return result as SwitchSystem;
}

function parseOwnership(value: unknown, path: string): SwitchOwnership {
  const result = string(value, path);
  if (!switchOwnerships.includes(result as SwitchOwnership)) {
    fail(path, `必须是 ${switchOwnerships.join("、")} 之一`);
  }
  return result as SwitchOwnership;
}

function parseLocale(value: unknown, path: string): string {
  const result = cleanString(value, path, 64);
  try {
    return new Intl.Locale(result).toString();
  } catch {
    fail(path, "必须是有效的 BCP 47 locale");
  }
}

function normaliseOptions(options: SwitchImportOptions): Required<SwitchImportOptions> {
  return {
    defaultSystem: parseSystem(options.defaultSystem ?? DEFAULT_SWITCH_SYSTEM, "options.defaultSystem"),
    locale: parseLocale(options.locale ?? DEFAULT_SWITCH_LOCALE, "options.locale")
  };
}

function optionalTextField(
  item: Record<string, unknown>,
  key: keyof SwitchImportRecord
): unknown {
  const value = item[key];
  if (value === undefined) return undefined;
  if (value === "") return undefined;
  return value;
}

function parseManualRecord(
  value: unknown,
  path: string,
  defaultSystem: SwitchSystem
): SwitchImportRecord {
  const item = record(value, path);
  for (const key of Object.keys(item)) {
    if (!MANUAL_FIELD_SET.has(key)) fail(`${path}.${key}`, "不是允许的导入字段");
  }

  const result: SwitchImportRecord = {
    title: cleanString(item.title, `${path}.title`, MAX_TITLE_LENGTH),
    system: item.system === undefined || item.system === ""
      ? defaultSystem
      : parseSystem(item.system, `${path}.system`),
    ownership: parseOwnership(item.ownership, `${path}.ownership`)
  };

  const externalId = optionalTextField(item, "externalId");
  if (externalId !== undefined) result.externalId = parseApplicationId(externalId, `${path}.externalId`);

  const playMinutes = optionalTextField(item, "playMinutes");
  if (playMinutes !== undefined) result.playMinutes = nonNegativeInteger(playMinutes, `${path}.playMinutes`);

  const firstPlayed = optionalTextField(item, "firstPlayed");
  if (firstPlayed !== undefined) result.firstPlayed = parseDate(firstPlayed, `${path}.firstPlayed`);

  const lastPlayed = optionalTextField(item, "lastPlayed");
  if (lastPlayed !== undefined) result.lastPlayed = parseDate(lastPlayed, `${path}.lastPlayed`);

  const coverUrl = optionalTextField(item, "coverUrl");
  if (coverUrl !== undefined) result.coverUrl = parseHttpsUrl(coverUrl, `${path}.coverUrl`);

  if (
    result.firstPlayed !== undefined
    && result.lastPlayed !== undefined
    && Date.parse(result.firstPlayed) > Date.parse(result.lastPlayed)
  ) {
    fail(path, "firstPlayed 不能晚于 lastPlayed");
  }

  return result;
}

function validateUniqueGames(games: readonly SwitchImportRecord[], path: string): void {
  const seen = new Map<string, number>();
  games.forEach((game, index) => {
    const identity = game.externalId === undefined
      ? `${game.system}:title:${game.title.normalize("NFKC").toLocaleLowerCase("ja-JP")}`
      : `${game.system}:id:${game.externalId}`;
    const previous = seen.get(identity);
    if (previous !== undefined) fail(`${path}[${index}]`, `与 ${path}[${previous}] 重复`);
    seen.set(identity, index);
  });
}

export function parseSwitchImportValue(
  value: unknown,
  options: SwitchImportOptions = {}
): SwitchImportBatch {
  const normalised = normaliseOptions(options);
  if (!Array.isArray(value)) fail("switchImport", "必须是游戏对象数组");
  if (value.length > MAX_RECORDS) fail("switchImport", `最多只能包含 ${MAX_RECORDS} 条记录`);
  const games = value.map((item, index) =>
    parseManualRecord(item, `switchImport[${index}]`, normalised.defaultSystem)
  );
  validateUniqueGames(games, "switchImport");
  return { locale: normalised.locale, games };
}

export function parseSwitchImportJson(
  source: string,
  options: SwitchImportOptions = {}
): SwitchImportBatch {
  if (typeof source !== "string") fail("switchImport", "JSON 输入必须是字符串");
  if (source.length > MAX_SOURCE_LENGTH) fail("switchImport", "JSON 输入过大");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    fail("switchImport", "必须是有效 JSON");
  }
  return parseSwitchImportValue(value, options);
}

function parseCsvRows(source: string): string[][] {
  if (source.length > MAX_SOURCE_LENGTH) fail("switchImport", "CSV 输入过大");
  if (!source) fail("switchImport.csv", "不能为空");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;

  const endField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === undefined) continue;

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      fail(`switchImport.csv:${line}`, "引号结束后只能出现逗号或换行");
    }
    if (character === '"') {
      if (field) fail(`switchImport.csv:${line}`, "字段中间不能开始引号");
      quoted = true;
    } else if (character === ",") {
      endField();
    } else if (character === "\n") {
      endRow();
      line += 1;
    } else if (character === "\r") {
      if (source[index + 1] !== "\n") endRow();
    } else {
      field += character;
    }
  }

  if (quoted) fail(`switchImport.csv:${line}`, "存在未闭合的引号");
  if (field || row.length > 0 || source.at(-1) !== "\n") endRow();
  return rows;
}

export function parseSwitchImportCsv(
  source: string,
  options: SwitchImportOptions = {}
): SwitchImportBatch {
  if (typeof source !== "string") fail("switchImport", "CSV 输入必须是字符串");
  const rows = parseCsvRows(source);
  const header = rows[0];
  if (!header) fail("switchImport.csv", "必须包含表头");
  if (header[0]?.startsWith("\uFEFF")) header[0] = header[0].slice(1);

  const seenHeaders = new Set<string>();
  header.forEach((name, index) => {
    if (!name) fail(`switchImport.csv.header[${index}]`, "不能为空");
    if (!MANUAL_FIELD_SET.has(name)) fail(`switchImport.csv.header[${index}]`, `未知字段 ${name}`);
    if (seenHeaders.has(name)) fail(`switchImport.csv.header[${index}]`, `字段 ${name} 重复`);
    seenHeaders.add(name);
  });
  for (const required of ["title", "ownership"] as const) {
    if (!seenHeaders.has(required)) fail("switchImport.csv.header", `缺少 ${required} 字段`);
  }

  const normalised = normaliseOptions(options);
  const games: SwitchImportRecord[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    if (!cells || cells.every((cell) => cell === "")) continue;
    if (cells.length !== header.length) {
      fail(`switchImport.csv.row[${index}]`, `必须有 ${header.length} 列，实际为 ${cells.length} 列`);
    }
    const item: Record<string, unknown> = {};
    header.forEach((name, cellIndex) => {
      const value = cells[cellIndex] ?? "";
      if (name === "playMinutes" && value !== "") {
        if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
          fail(`switchImport.csv.row[${index}].playMinutes`, "必须是非负整数");
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
          fail(`switchImport.csv.row[${index}].playMinutes`, "必须是非负安全整数");
        }
        item[name] = parsed;
      } else {
        item[name] = value;
      }
    });
    games.push(parseManualRecord(item, `switchImport.csv.row[${index}]`, normalised.defaultSystem));
    if (games.length > MAX_RECORDS) fail("switchImport.csv", `最多只能包含 ${MAX_RECORDS} 条记录`);
  }
  validateUniqueGames(games, "switchImport.csv.games");
  return { locale: normalised.locale, games };
}

export function parseSwitchImport(
  source: string,
  format: SwitchImportFormat,
  options: SwitchImportOptions = {}
): SwitchImportBatch {
  if (format === "json") return parseSwitchImportJson(source, options);
  if (format === "csv") return parseSwitchImportCsv(source, options);
  fail("switchImport.format", "必须是 json 或 csv");
}

interface NxapiTitle {
  externalId: string;
  title: string;
  firstPlayed: string;
  coverUrl?: string;
}

function nxapiArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  if (value.length > MAX_RECORDS) fail(path, `最多只能包含 ${MAX_RECORDS} 项`);
  return value;
}

function nxapiResult(value: unknown, path: string): NxapiDailySummaryResult {
  const result = string(value, path);
  if (!["ACHIEVED", "CALCULATING", "UNACHIEVED"].includes(result)) {
    fail(path, "必须是 ACHIEVED、CALCULATING 或 UNACHIEVED");
  }
  return result as NxapiDailySummaryResult;
}

function nxapiCover(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const images = record(value, path);
  for (const key of ["extraLarge", "large", "medium", "small", "extraSmall"] as const) {
    if (images[key] !== undefined && images[key] !== null && images[key] !== "") {
      return parseHttpsUrl(images[key], `${path}.${key}`);
    }
  }
  return undefined;
}

function parseNxapiTitle(value: unknown, path: string): NxapiTitle {
  const item = record(value, path);
  const result: NxapiTitle = {
    externalId: parseApplicationId(item.applicationId, `${path}.applicationId`),
    title: cleanString(item.title, `${path}.title`, MAX_TITLE_LENGTH),
    firstPlayed: parseDate(item.firstPlayDate, `${path}.firstPlayDate`, true)
  };
  const coverUrl = nxapiCover(item.imageUri, `${path}.imageUri`);
  if (coverUrl !== undefined) result.coverUrl = coverUrl;
  return result;
}

function addNxapiPlayerTimes(
  value: unknown,
  path: string,
  knownTitles: ReadonlyMap<string, NxapiTitle>,
  secondsByTitle: Map<string, number>
): void {
  const player = record(value, path);
  nonNegativeInteger(player.playingTime, `${path}.playingTime`);
  const playedApps = nxapiArray(player.playedApps, `${path}.playedApps`);
  const playerIds = new Set<string>();
  playedApps.forEach((rawApp, index) => {
    const appPath = `${path}.playedApps[${index}]`;
    const app = record(rawApp, appPath);
    const externalId = parseApplicationId(app.applicationId, `${appPath}.applicationId`);
    if (playerIds.has(externalId)) fail(appPath, "同一玩家日报中 Application ID 重复");
    playerIds.add(externalId);
    if (!knownTitles.has(externalId)) fail(`${appPath}.applicationId`, "未出现在日报 playedApps 中");
    parseDate(app.firstPlayDate, `${appPath}.firstPlayDate`, true);
    const seconds = nonNegativeInteger(app.playingTime, `${appPath}.playingTime`);
    secondsByTitle.set(externalId, (secondsByTitle.get(externalId) ?? 0) + seconds);
  });
}

export function parseNxapiParentalDailySummary(
  value: unknown,
  options: SwitchImportOptions = {}
): NxapiParentalDailySummary {
  const normalised = normaliseOptions(options);
  const summary = record(value, "nxapiDailySummary");
  const date = parseDate(summary.date, "nxapiDailySummary.date", true);
  const result = nxapiResult(summary.result, "nxapiDailySummary.result");
  const playedApps = nxapiArray(summary.playedApps, "nxapiDailySummary.playedApps");
  const knownTitles = new Map<string, NxapiTitle>();

  playedApps.forEach((rawTitle, index) => {
    const title = parseNxapiTitle(rawTitle, `nxapiDailySummary.playedApps[${index}]`);
    if (knownTitles.has(title.externalId)) {
      fail(`nxapiDailySummary.playedApps[${index}].applicationId`, "在日报中重复");
    }
    if (Date.parse(title.firstPlayed) > Date.parse(date)) {
      fail(`nxapiDailySummary.playedApps[${index}].firstPlayDate`, "不能晚于日报日期");
    }
    knownTitles.set(title.externalId, title);
  });

  const secondsByTitle = new Map<string, number>();
  for (const externalId of knownTitles.keys()) secondsByTitle.set(externalId, 0);

  const devicePlayers = nxapiArray(summary.devicePlayers, "nxapiDailySummary.devicePlayers");
  devicePlayers.forEach((player, index) =>
    addNxapiPlayerTimes(
      player,
      `nxapiDailySummary.devicePlayers[${index}]`,
      knownTitles,
      secondsByTitle
    )
  );
  if (summary.anonymousPlayer !== null && summary.anonymousPlayer !== undefined) {
    addNxapiPlayerTimes(
      summary.anonymousPlayer,
      "nxapiDailySummary.anonymousPlayer",
      knownTitles,
      secondsByTitle
    );
  }

  const games = [...knownTitles.values()].map((title): NxapiParentalDailyGame => {
    const playSeconds = secondsByTitle.get(title.externalId) ?? 0;
    const game: NxapiParentalDailyGame = {
      title: title.title,
      externalId: title.externalId,
      playSeconds,
      playMinutes: Math.floor(playSeconds / 60),
      firstPlayed: title.firstPlayed,
      lastPlayed: date,
      system: normalised.defaultSystem,
      ownership: "played"
    };
    if (title.coverUrl !== undefined) game.coverUrl = title.coverUrl;
    return game;
  });

  return {
    deviceId: cleanString(summary.deviceId, "nxapiDailySummary.deviceId", MAX_IDENTIFIER_LENGTH),
    date,
    result,
    complete: result === "ACHIEVED",
    updatedAt: nonNegativeInteger(summary.updatedAt, "nxapiDailySummary.updatedAt"),
    totalPlayingSeconds: nonNegativeInteger(summary.playingTime, "nxapiDailySummary.playingTime"),
    locale: normalised.locale,
    system: normalised.defaultSystem,
    games
  };
}

export function parseNxapiParentalDailySummaries(
  value: unknown,
  options: SwitchImportOptions = {}
): NxapiParentalDailySummary[] {
  const response = record(value, "nxapiDailySummaries");
  const rawItems = nxapiArray(response.items, "nxapiDailySummaries.items");
  const count = nonNegativeInteger(response.count, "nxapiDailySummaries.count");
  if (count !== rawItems.length) fail("nxapiDailySummaries.count", "必须与 items 数量一致");
  if (response.updatedRecently !== undefined && typeof response.updatedRecently !== "boolean") {
    fail("nxapiDailySummaries.updatedRecently", "必须是布尔值");
  }
  return rawItems.map((item) => parseNxapiParentalDailySummary(item, options));
}

export function parseNxapiParentalDailySummariesJson(
  source: string,
  options: SwitchImportOptions = {}
): NxapiParentalDailySummary[] {
  if (typeof source !== "string") fail("nxapiDailySummaries", "JSON 输入必须是字符串");
  if (source.length > MAX_SOURCE_LENGTH) fail("nxapiDailySummaries", "JSON 输入过大");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    fail("nxapiDailySummaries", "必须是有效 JSON");
  }
  return parseNxapiParentalDailySummaries(value, options);
}

const HISTORY_SUMMARY_FIELDS = [
  "deviceId",
  "date",
  "result",
  "complete",
  "updatedAt",
  "totalPlayingSeconds",
  "locale",
  "system",
  "games"
] as const;
const HISTORY_GAME_FIELDS = [
  "title",
  "externalId",
  "playSeconds",
  "playMinutes",
  "firstPlayed",
  "lastPlayed",
  "system",
  "ownership",
  "coverUrl"
] as const;
const HISTORY_SUMMARY_FIELD_SET = new Set<string>(HISTORY_SUMMARY_FIELDS);
const HISTORY_GAME_FIELD_SET = new Set<string>(HISTORY_GAME_FIELDS);

function rejectUnknownFields(
  item: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  path: string
): void {
  for (const key of Object.keys(item)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "不是允许的历史字段");
  }
}

function parseHistoryGame(
  value: unknown,
  path: string,
  summaryDate: string,
  summarySystem: SwitchSystem
): NxapiParentalDailyGame {
  const item = record(value, path);
  rejectUnknownFields(item, HISTORY_GAME_FIELD_SET, path);

  const playSeconds = nonNegativeInteger(item.playSeconds, `${path}.playSeconds`);
  const playMinutes = nonNegativeInteger(item.playMinutes, `${path}.playMinutes`);
  if (playMinutes !== Math.floor(playSeconds / 60)) {
    fail(`${path}.playMinutes`, "必须等于 playSeconds 向下换算的分钟数");
  }

  const firstPlayed = parseDate(item.firstPlayed, `${path}.firstPlayed`, true);
  const lastPlayed = parseDate(item.lastPlayed, `${path}.lastPlayed`, true);
  if (lastPlayed !== summaryDate) fail(`${path}.lastPlayed`, "必须等于所属日报日期");
  if (Date.parse(firstPlayed) > Date.parse(lastPlayed)) {
    fail(`${path}.firstPlayed`, "不能晚于 lastPlayed");
  }

  const system = parseSystem(item.system, `${path}.system`);
  if (system !== summarySystem) fail(`${path}.system`, "必须与所属日报 system 一致");
  if (item.ownership !== "played") fail(`${path}.ownership`, "必须是 played");

  const game: NxapiParentalDailyGame = {
    title: cleanString(item.title, `${path}.title`, MAX_TITLE_LENGTH),
    externalId: parseApplicationId(item.externalId, `${path}.externalId`),
    playSeconds,
    playMinutes,
    firstPlayed,
    lastPlayed,
    system,
    ownership: "played"
  };
  if (item.coverUrl !== undefined) {
    game.coverUrl = parseHttpsUrl(item.coverUrl, `${path}.coverUrl`);
  }
  return game;
}

function parseHistorySummary(value: unknown, path: string): NxapiParentalDailySummary {
  const item = record(value, path);
  rejectUnknownFields(item, HISTORY_SUMMARY_FIELD_SET, path);

  const date = parseDate(item.date, `${path}.date`, true);
  const result = nxapiResult(item.result, `${path}.result`);
  if (typeof item.complete !== "boolean") fail(`${path}.complete`, "必须是布尔值");
  if (item.complete !== (result === "ACHIEVED")) {
    fail(`${path}.complete`, "必须与 result 的完成状态一致");
  }
  const system = parseSystem(item.system, `${path}.system`);
  const rawGames = nxapiArray(item.games, `${path}.games`);
  const games = rawGames.map((game, index) =>
    parseHistoryGame(game, `${path}.games[${index}]`, date, system)
  );

  const seenGames = new Set<string>();
  games.forEach((game, index) => {
    const key = `${game.system}:${game.externalId}`;
    if (seenGames.has(key)) fail(`${path}.games[${index}]`, "在同一日报中重复");
    seenGames.add(key);
  });

  return {
    deviceId: cleanString(item.deviceId, `${path}.deviceId`, MAX_IDENTIFIER_LENGTH),
    date,
    result,
    complete: item.complete,
    updatedAt: nonNegativeInteger(item.updatedAt, `${path}.updatedAt`),
    totalPlayingSeconds: nonNegativeInteger(
      item.totalPlayingSeconds,
      `${path}.totalPlayingSeconds`
    ),
    locale: parseLocale(item.locale, `${path}.locale`),
    system,
    games
  };
}

/**
 * Parses the persisted, already-sanitised daily-history format. Unlike the raw
 * nxapi parser, this schema rejects every field outside the public summary
 * interface so account identifiers, player records, and tokens cannot hitch a
 * ride into the Actions state file.
 */
export function parseNxapiDailySummaryHistory(
  value: unknown
): NxapiParentalDailySummary[] {
  if (!Array.isArray(value)) fail("nxapiDailyHistory", "必须是脱敏日报数组");
  if (value.length > MAX_RECORDS) {
    fail("nxapiDailyHistory", `最多只能包含 ${MAX_RECORDS} 条日报`);
  }

  let gameCount = 0;
  const identities = new Set<string>();
  const parsed = value.map((item, index) => {
    const summary = parseHistorySummary(item, `nxapiDailyHistory[${index}]`);
    gameCount += summary.games.length;
    if (gameCount > MAX_HISTORY_GAMES) {
      fail("nxapiDailyHistory", `最多只能包含 ${MAX_HISTORY_GAMES} 条日报游戏记录`);
    }
    const identity = `${summary.deviceId}\u0000${summary.date}`;
    if (identities.has(identity)) {
      fail(`nxapiDailyHistory[${index}]`, "设备与日期组合重复");
    }
    identities.add(identity);
    return summary;
  });

  const locale = parsed[0]?.locale;
  if (locale !== undefined && parsed.some((summary) => summary.locale !== locale)) {
    fail("nxapiDailyHistory", "不能混合不同 locale 的日报");
  }
  return parsed;
}

export function parseNxapiDailySummaryHistoryJson(
  source: string
): NxapiParentalDailySummary[] {
  if (typeof source !== "string") fail("nxapiDailyHistory", "JSON 输入必须是字符串");
  if (source.length > MAX_SOURCE_LENGTH) fail("nxapiDailyHistory", "JSON 输入过大");
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    fail("nxapiDailyHistory", "必须是有效 JSON");
  }
  return parseNxapiDailySummaryHistory(value);
}

export function serializeNxapiDailySummaryHistory(
  summaries: readonly NxapiParentalDailySummary[]
): string {
  const parsed = parseNxapiDailySummaryHistory(summaries);
  parsed.sort((left, right) =>
    left.deviceId.localeCompare(right.deviceId, "en")
      || left.date.localeCompare(right.date, "en")
  );
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function preferDailySummary(
  current: NxapiParentalDailySummary,
  candidate: NxapiParentalDailySummary
): NxapiParentalDailySummary {
  if (current.complete !== candidate.complete) return candidate.complete ? candidate : current;
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

/**
 * Selects one mutable daily report per device/date. A completed report always
 * wins over a calculating report; reports with equal completion status use the
 * newest updatedAt value. Input order breaks exact ties, so newly fetched data
 * can replace an older persisted copy deterministically.
 */
export function mergeNxapiDailySummaries(
  summaries: readonly NxapiParentalDailySummary[]
): NxapiParentalDailySummary[] {
  if (summaries.length > MAX_RECORDS * 2) {
    fail("nxapiDailySummaries", "待合并日报数量过多");
  }
  const locale = summaries[0]?.locale;
  for (const summary of summaries) {
    if (locale !== undefined && summary.locale !== locale) {
      fail("nxapiDailySummaries", "不能混合不同 locale 的日报");
    }
  }

  const daily = new Map<string, NxapiParentalDailySummary>();
  for (const summary of summaries) {
    const key = `${summary.deviceId}\u0000${summary.date}`;
    const existing = daily.get(key);
    daily.set(key, existing === undefined ? summary : preferDailySummary(existing, summary));
  }
  if (daily.size > MAX_RECORDS) {
    fail("nxapiDailyHistory", `最多只能包含 ${MAX_RECORDS} 条日报`);
  }
  return [...daily.values()].sort((left, right) =>
    left.deviceId.localeCompare(right.deviceId, "en")
      || left.date.localeCompare(right.date, "en")
  );
}

/**
 * Deduplicates mutable daily summaries and accumulates seconds before rounding
 * to minutes, avoiding one rounding loss per day.
 */
export function aggregateNxapiDailySummaries(
  summaries: readonly NxapiParentalDailySummary[]
): SwitchImportBatch {
  const locale = summaries[0]?.locale ?? DEFAULT_SWITCH_LOCALE;
  const daily = mergeNxapiDailySummaries(summaries);

  interface AccumulatedGame {
    title: string;
    externalId: string;
    playSeconds: number;
    firstPlayed: string;
    lastPlayed: string;
    system: SwitchSystem;
    titleTimestamp: number;
    coverUrl?: string;
  }

  const accumulated = new Map<string, AccumulatedGame>();
  for (const summary of daily) {
    for (const game of summary.games) {
      const key = `${game.system}:${game.externalId}`;
      const existing = accumulated.get(key);
      if (existing === undefined) {
        const initial: AccumulatedGame = {
          title: game.title,
          externalId: game.externalId,
          playSeconds: game.playSeconds,
          firstPlayed: game.firstPlayed,
          lastPlayed: game.lastPlayed,
          system: game.system,
          titleTimestamp: summary.updatedAt
        };
        if (game.coverUrl !== undefined) initial.coverUrl = game.coverUrl;
        accumulated.set(key, initial);
        continue;
      }
      existing.playSeconds += game.playSeconds;
      if (Date.parse(game.firstPlayed) < Date.parse(existing.firstPlayed)) {
        existing.firstPlayed = game.firstPlayed;
      }
      if (Date.parse(game.lastPlayed) > Date.parse(existing.lastPlayed)) {
        existing.lastPlayed = game.lastPlayed;
      }
      if (summary.updatedAt >= existing.titleTimestamp) {
        existing.title = game.title;
        existing.titleTimestamp = summary.updatedAt;
        if (game.coverUrl !== undefined) existing.coverUrl = game.coverUrl;
      }
    }
  }

  const games = [...accumulated.values()]
    .sort((left, right) => left.externalId.localeCompare(right.externalId, "en"))
    .map((game): SwitchImportRecord => {
      const result: SwitchImportRecord = {
        title: game.title,
        externalId: game.externalId,
        playMinutes: Math.floor(game.playSeconds / 60),
        firstPlayed: game.firstPlayed,
        lastPlayed: game.lastPlayed,
        system: game.system,
        ownership: "played"
      };
      if (game.coverUrl !== undefined) result.coverUrl = game.coverUrl;
      return result;
    });

  return { locale, games };
}
