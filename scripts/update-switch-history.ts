import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aggregateNxapiDailySummaries,
  mergeNxapiDailySummaries,
  parseNxapiParentalDailySummariesJson,
  parseNxapiDailySummaryHistoryJson,
  parseSwitchImportValue,
  serializeNxapiDailySummaryHistory
} from "./lib/switch-import";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;

export type SwitchHistoryErrorCode =
  | "usage"
  | "path-conflict"
  | "history-read-failed"
  | "response-read-failed"
  | "input-too-large"
  | "history-invalid"
  | "response-invalid"
  | "history-write-failed"
  | "output-write-failed"
  | "aggregation-failed";

const ERROR_MESSAGES: Readonly<Record<SwitchHistoryErrorCode, string>> = {
  usage: "用法：update-switch-history <history-json> <new-raw-response-json> <output-manual-import-json>",
  "path-conflict": "Switch 历史、原始响应与导出文件必须使用不同路径",
  "history-read-failed": "无法读取 Switch 脱敏历史文件",
  "response-read-failed": "无法读取新的 Switch 日报响应文件",
  "input-too-large": "Switch 日报输入文件过大",
  "history-invalid": "Switch 脱敏历史文件格式无效",
  "response-invalid": "新的 Switch 日报响应格式无效",
  "history-write-failed": "无法原子写入 Switch 脱敏历史文件",
  "output-write-failed": "无法原子写入 Switch 手动导入文件",
  "aggregation-failed": "无法合并 Switch 日报历史"
};

export class SwitchHistoryError extends Error {
  readonly code: SwitchHistoryErrorCode;

  constructor(code: SwitchHistoryErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SwitchHistoryError";
    this.code = code;
  }
}

export interface SwitchHistoryUpdateResult {
  historyDays: number;
  games: number;
}

function fail(code: SwitchHistoryErrorCode): never {
  throw new SwitchHistoryError(code);
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

async function readBoundedUtf8(
  path: string,
  missingIsEmpty: boolean,
  errorCode: "history-read-failed" | "response-read-failed"
): Promise<string | undefined> {
  let contents: Buffer;
  try {
    contents = await readFile(path);
  } catch (error) {
    if (missingIsEmpty && isErrorCode(error, "ENOENT")) return undefined;
    fail(errorCode);
  }
  if (contents.byteLength > MAX_INPUT_BYTES) fail("input-too-large");
  return contents.toString("utf8");
}

async function writeAtomic(
  destination: string,
  contents: string,
  errorCode: "history-write-failed" | "output-write-failed"
): Promise<void> {
  const output = resolve(destination);
  const directory = dirname(output);
  const temporary = resolve(
    directory,
    `.${basename(output)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, output);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    fail(errorCode);
  }
}

export async function runUpdateSwitchHistoryCli(
  args: readonly string[]
): Promise<SwitchHistoryUpdateResult> {
  const [historyArgument, responseArgument, outputArgument, ...extra] = args;
  if (
    historyArgument === undefined
    || responseArgument === undefined
    || outputArgument === undefined
    || extra.length > 0
  ) {
    fail("usage");
  }

  const historyPath = resolve(historyArgument);
  const responsePath = resolve(responseArgument);
  const outputPath = resolve(outputArgument);
  if (new Set([historyPath, responsePath, outputPath]).size !== 3) fail("path-conflict");

  const historySource = await readBoundedUtf8(historyPath, true, "history-read-failed");
  const responseSource = await readBoundedUtf8(responsePath, false, "response-read-failed");

  let history;
  try {
    history = historySource === undefined
      ? []
      : parseNxapiDailySummaryHistoryJson(historySource);
  } catch {
    fail("history-invalid");
  }

  let incoming;
  try {
    incoming = parseNxapiParentalDailySummariesJson(responseSource as string);
  } catch {
    fail("response-invalid");
  }

  let merged;
  let manualGames;
  try {
    merged = mergeNxapiDailySummaries([...history, ...incoming]);
    const aggregate = aggregateNxapiDailySummaries(merged);
    manualGames = parseSwitchImportValue(aggregate.games, {
      locale: aggregate.locale,
      defaultSystem: "switch"
    }).games;
  } catch {
    fail("aggregation-failed");
  }

  await writeAtomic(
    historyPath,
    serializeNxapiDailySummaryHistory(merged),
    "history-write-failed"
  );
  await writeAtomic(
    outputPath,
    `${JSON.stringify(manualGames, null, 2)}\n`,
    "output-write-failed"
  );

  return { historyDays: merged.length, games: manualGames.length };
}

// Short alias for callers that treat this module as a CLI adapter.
export const runSwitchHistoryCli = runUpdateSwitchHistoryCli;

async function main(): Promise<void> {
  try {
    const result = await runUpdateSwitchHistoryCli(process.argv.slice(2));
    console.log(`Switch 脱敏历史已更新：${result.historyDays} 日，${result.games} 款游戏`);
  } catch (error) {
    console.error(
      error instanceof SwitchHistoryError
        ? error.message
        : "Switch 日报历史更新失败"
    );
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  await main();
}
