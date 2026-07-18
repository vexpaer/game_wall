import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  runUpdateSwitchHistoryCli,
  SwitchHistoryError
} from "../scripts/update-switch-history";
import {
  parseNxapiParentalDailySummaries,
  parseNxapiDailySummaryHistory,
  parseNxapiDailySummaryHistoryJson,
  parseSwitchImportJson,
  serializeNxapiDailySummaryHistory
} from "../scripts/lib/switch-import";

const GAME_ID = "0100F2C0115B6000";
const COVER = "https://example.test/zelda.jpg";

function rawDay(
  date: string,
  seconds: number,
  result: "ACHIEVED" | "CALCULATING" = "ACHIEVED",
  updatedAt = 1
): Record<string, unknown> {
  return {
    deviceId: "switch-lite-jp",
    date,
    result,
    playingTime: seconds,
    updatedAt,
    // Raw-only fields prove the persisted history is produced from a whitelist.
    sessionToken: "must-never-be-persisted",
    devicePlayers: [{
      playerId: "private-player-id",
      nickname: "private-nickname",
      playingTime: seconds,
      playedApps: [{
        applicationId: GAME_ID,
        firstPlayDate: "2026-07-01",
        playingTime: seconds
      }]
    }],
    anonymousPlayer: null,
    playedApps: [{
      applicationId: GAME_ID,
      title: updatedAt >= 300 ? "ゼルダの伝説 TotK" : "ゼルダの伝説",
      firstPlayDate: "2026-07-01",
      imageUri: { extraLarge: COVER }
    }]
  };
}

function rawResponse(items: Record<string, unknown>[]): string {
  return JSON.stringify({
    count: items.length,
    updatedRecently: false,
    accountToken: "also-must-never-be-persisted",
    items
  });
}

test("sanitised nxapi history has a strict, deterministic round trip", () => {
  const summaries = parseNxapiParentalDailySummaries({
    count: 1,
    items: [rawDay("2026-07-18", 61, "ACHIEVED", 100)]
  });
  const serialized = serializeNxapiDailySummaryHistory(summaries);
  const reparsed = parseNxapiDailySummaryHistoryJson(serialized);

  assert.deepEqual(reparsed, summaries);
  assert.doesNotMatch(serialized, /sessionToken|accountToken|playerId|nickname|private-/u);
  assert.equal(serialized, serializeNxapiDailySummaryHistory(reparsed));
});

test("sanitised history rejects duplicate dates and every non-interface field", () => {
  const [summary] = parseNxapiParentalDailySummaries({
    count: 1,
    items: [rawDay("2026-07-18", 61)]
  });
  assert.ok(summary);

  assert.throws(
    () => parseNxapiDailySummaryHistory([summary, summary]),
    /设备与日期组合重复/u
  );
  assert.throws(
    () => parseNxapiDailySummaryHistory([{ ...summary, sessionToken: "secret" }]),
    /sessionToken.*不是允许的历史字段/u
  );
  assert.throws(
    () => parseNxapiDailySummaryHistory([{
      ...summary,
      games: [{ ...summary.games[0], playerId: "private" }]
    }]),
    /playerId.*不是允许的历史字段/u
  );
  assert.throws(
    () => parseNxapiDailySummaryHistory([{
      ...summary,
      games: [{ ...summary.games[0], playMinutes: 999 }]
    }]),
    /playMinutes.*向下换算/u
  );
});

test("CLI accumulates across runs and replaces a mutable day exactly once", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "game-wall-switch-history-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));

  const historyPath = join(directory, "history.json");
  const responsePath = join(directory, "response.json");
  const outputPath = join(directory, "switch-import.json");

  await writeFile(
    responsePath,
    rawResponse([rawDay("2026-07-17", 20, "CALCULATING", 100)])
  );
  assert.deepEqual(
    await runUpdateSwitchHistoryCli([historyPath, responsePath, outputPath]),
    { historyDays: 1, games: 1 }
  );

  // The newer calculating copy must not beat the completed copy, even though
  // the completed copy has an older updatedAt. The second date is accumulated.
  await writeFile(responsePath, rawResponse([
    rawDay("2026-07-17", 50, "CALCULATING", 500),
    rawDay("2026-07-17", 31, "ACHIEVED", 300),
    rawDay("2026-07-18", 31, "ACHIEVED", 400)
  ]));
  assert.deepEqual(
    await runUpdateSwitchHistoryCli([historyPath, responsePath, outputPath]),
    { historyDays: 2, games: 1 }
  );

  const historySource = await readFile(historyPath, "utf8");
  const history = parseNxapiDailySummaryHistoryJson(historySource);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.date, "2026-07-17");
  assert.equal(history[0]?.complete, true);
  assert.equal(history[0]?.games[0]?.playSeconds, 31);
  assert.doesNotMatch(historySource, /must-never|private-|sessionToken|accountToken/u);

  const manualSource = await readFile(outputPath, "utf8");
  const manual = parseSwitchImportJson(manualSource);
  assert.deepEqual(manual.games, [{
    title: "ゼルダの伝説 TotK",
    externalId: GAME_ID,
    playMinutes: 1,
    firstPlayed: "2026-07-01",
    lastPlayed: "2026-07-18",
    system: "switch",
    ownership: "played",
    coverUrl: COVER
  }]);
});

test("CLI rejects polluted history with a static error that never echoes data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "game-wall-switch-pollution-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));

  const historyPath = join(directory, "history.json");
  const responsePath = join(directory, "response.json");
  const outputPath = join(directory, "output.json");
  const secret = "highly-sensitive-session-token";
  const [summary] = parseNxapiParentalDailySummaries({
    count: 1,
    items: [rawDay("2026-07-18", 60)]
  });
  assert.ok(summary);
  await writeFile(historyPath, JSON.stringify([{ ...summary, userToken: secret }]));
  await writeFile(responsePath, rawResponse([]));

  await assert.rejects(
    runUpdateSwitchHistoryCli([historyPath, responsePath, outputPath]),
    (error: unknown) => {
      assert.ok(error instanceof SwitchHistoryError);
      assert.equal(error.code, "history-invalid");
      assert.equal(error.message, "Switch 脱敏历史文件格式无效");
      assert.doesNotMatch(error.message, new RegExp(secret, "u"));
      return true;
    }
  );
});
