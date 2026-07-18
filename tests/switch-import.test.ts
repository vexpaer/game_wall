import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateNxapiDailySummaries,
  parseNxapiParentalDailySummaries,
  parseNxapiParentalDailySummariesJson,
  parseNxapiParentalDailySummary,
  parseSwitchImport,
  parseSwitchImportCsv,
  parseSwitchImportJson
} from "../scripts/lib/switch-import";

const ZELDA_ID = "0100F2C0115B6000";
const MARIO_ID = "0100152000022000";
const COVER = "https://example.test/zelda-large.jpg";

function nxapiTitle(
  applicationId: string,
  title: string,
  firstPlayDate = "2026-07-01"
): Record<string, unknown> {
  return {
    applicationId,
    title,
    imageUri: {
      extraSmall: "https://example.test/extra-small.jpg",
      small: "https://example.test/small.jpg",
      medium: "https://example.test/medium.jpg",
      large: "https://example.test/large.jpg",
      extraLarge: applicationId === ZELDA_ID ? COVER : "https://example.test/extra-large.jpg"
    },
    hasUgc: false,
    shopUri: "https://ec.nintendo.com/apps/example/JP",
    firstPlayDate
  };
}

function nxapiPlayerApp(
  applicationId: string,
  playingTime: number,
  firstPlayDate = "2026-07-01"
): Record<string, unknown> {
  return { applicationId, firstPlayDate, playingTime };
}

function nxapiDailyFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId: "switch-lite-device",
    date: "2026-07-18",
    result: "ACHIEVED",
    playingTime: 210,
    exceededTime: null,
    disabledTime: 0,
    miscTime: 0,
    importantInfos: [],
    notices: [],
    observations: [],
    playedApps: [
      nxapiTitle(ZELDA_ID, "ゼルダの伝説 ティアーズ オブ ザ キングダム"),
      nxapiTitle(MARIO_ID, "マリオカート８ デラックス")
    ],
    anonymousPlayer: {
      playingTime: 30,
      playedApps: [nxapiPlayerApp(ZELDA_ID, 30)]
    },
    devicePlayers: [
      {
        playerId: "private-player-id",
        nickname: "private nickname",
        imageUri: "https://example.test/private-avatar.jpg",
        playingTime: 180,
        playedApps: [
          nxapiPlayerApp(ZELDA_ID, 90),
          nxapiPlayerApp(MARIO_ID, 90)
        ]
      }
    ],
    timeZoneUtcOffsetSeconds: 32_400,
    lastPlayedAt: 1_752_845_400,
    createdAt: 1_752_800_000,
    updatedAt: 1_752_845_500,
    ...overrides
  };
}

test("Switch JSON import normalises Japanese records with Switch Lite defaults", () => {
  const parsed = parseSwitchImportJson(JSON.stringify([
    {
      title: "  ゼルダの伝説 ティアーズ オブ ザ キングダム  ",
      externalId: ZELDA_ID.toLowerCase(),
      playMinutes: 1_234,
      firstPlayed: "2023-05-12",
      lastPlayed: "2026-07-18T20:00:00+09:00",
      ownership: "owned",
      coverUrl: COVER
    },
    {
      title: "Nintendo Switch Sports",
      ownership: "played",
      system: "switch"
    }
  ]));

  assert.equal(parsed.locale, "ja-JP");
  assert.deepEqual(parsed.games, [
    {
      title: "ゼルダの伝説 ティアーズ オブ ザ キングダム",
      externalId: ZELDA_ID,
      playMinutes: 1_234,
      firstPlayed: "2023-05-12",
      lastPlayed: "2026-07-18T20:00:00+09:00",
      system: "switch",
      ownership: "owned",
      coverUrl: COVER
    },
    {
      title: "Nintendo Switch Sports",
      system: "switch",
      ownership: "played"
    }
  ]);
});

test("Switch JSON import rejects unknown or malformed fields", () => {
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"owned","sessionToken":"secret"}]'),
    /sessionToken.*不是允许的导入字段/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"physical"}]'),
    /ownership.*必须是/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"owned","playMinutes":-1}]'),
    /playMinutes.*非负安全整数/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"owned","externalId":"123"}]'),
    /externalId.*16 位十六进制/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"owned","coverUrl":"http://example.test/a.jpg"}]'),
    /coverUrl.*HTTPS/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"owned","firstPlayed":"2026-02-30"}]'),
    /firstPlayed.*有效日历日期/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"Game","ownership":"owned","firstPlayed":"2026-07-19","lastPlayed":"2026-07-18"}]'),
    /firstPlayed 不能晚于 lastPlayed/u
  );
  assert.throws(
    () => parseSwitchImportJson('[{"title":"A","ownership":"owned"},{"title":"Ａ","ownership":"owned"}]'),
    /重复/u
  );
});

test("Switch CSV import supports RFC 4180 quoting, BOM, defaults, and optional fields", () => {
  const csv = [
    "\uFEFFtitle,externalId,playMinutes,firstPlayed,lastPlayed,system,ownership,coverUrl",
    `"ゼルダ, ティアーズ ""王国""",${ZELDA_ID},60,2026-07-01,2026-07-18,,owned,${COVER}`,
    "ピクミン４,,,,,,subscription,"
  ].join("\r\n");

  const parsed = parseSwitchImportCsv(csv);
  assert.equal(parsed.locale, "ja-JP");
  assert.deepEqual(parsed.games, [
    {
      title: 'ゼルダ, ティアーズ "王国"',
      externalId: ZELDA_ID,
      playMinutes: 60,
      firstPlayed: "2026-07-01",
      lastPlayed: "2026-07-18",
      system: "switch",
      ownership: "owned",
      coverUrl: COVER
    },
    { title: "ピクミン４", system: "switch", ownership: "subscription" }
  ]);
  assert.deepEqual(parseSwitchImport(csv, "csv"), parsed);
});

test("Switch CSV import rejects schema drift and broken rows", () => {
  assert.throws(
    () => parseSwitchImportCsv("title,ownership,cookie\nGame,owned,secret"),
    /未知字段 cookie/u
  );
  assert.throws(
    () => parseSwitchImportCsv("title,title,ownership\nGame,Game,owned"),
    /字段 title 重复/u
  );
  assert.throws(
    () => parseSwitchImportCsv("title\nGame"),
    /缺少 ownership/u
  );
  assert.throws(
    () => parseSwitchImportCsv("title,ownership,playMinutes\nGame,owned,01"),
    /playMinutes.*非负整数/u
  );
  assert.throws(
    () => parseSwitchImportCsv('title,ownership\n"Game,owned'),
    /未闭合的引号/u
  );
  assert.throws(
    () => parseSwitchImportCsv("title,ownership\nGame,owned,extra"),
    /必须有 2 列/u
  );
});

test("nxapi daily parser extracts only safe title deltas and sums player time", () => {
  const fixture = nxapiDailyFixture();
  const before = JSON.stringify(fixture);
  const parsed = parseNxapiParentalDailySummary(fixture);

  assert.equal(JSON.stringify(fixture), before, "纯函数不应改写 nxapi fixture");
  assert.equal(parsed.deviceId, "switch-lite-device");
  assert.equal(parsed.locale, "ja-JP");
  assert.equal(parsed.system, "switch");
  assert.equal(parsed.complete, true);
  assert.equal(parsed.totalPlayingSeconds, 210);
  assert.deepEqual(parsed.games, [
    {
      title: "ゼルダの伝説 ティアーズ オブ ザ キングダム",
      externalId: ZELDA_ID,
      playSeconds: 120,
      playMinutes: 2,
      firstPlayed: "2026-07-01",
      lastPlayed: "2026-07-18",
      system: "switch",
      ownership: "played",
      coverUrl: COVER
    },
    {
      title: "マリオカート８ デラックス",
      externalId: MARIO_ID,
      playSeconds: 90,
      playMinutes: 1,
      firstPlayed: "2026-07-01",
      lastPlayed: "2026-07-18",
      system: "switch",
      ownership: "played",
      coverUrl: "https://example.test/extra-large.jpg"
    }
  ]);
  assert.equal(JSON.stringify(parsed).includes("private nickname"), false);
  assert.equal(JSON.stringify(parsed).includes("private-player-id"), false);
});

test("nxapi wrapper parser validates counts and parses JSON without executing nxapi", () => {
  const response = { count: 1, updatedRecently: false, items: [nxapiDailyFixture()] };
  const parsed = parseNxapiParentalDailySummaries(response);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parseNxapiParentalDailySummariesJson(JSON.stringify(response)), parsed);

  assert.throws(
    () => parseNxapiParentalDailySummaries({ ...response, count: 2 }),
    /count.*items 数量一致/u
  );
  assert.throws(
    () => parseNxapiParentalDailySummary(nxapiDailyFixture({ result: "READY" })),
    /result.*ACHIEVED/u
  );
  assert.throws(
    () => parseNxapiParentalDailySummary(nxapiDailyFixture({
      devicePlayers: [{
        playingTime: 60,
        playedApps: [nxapiPlayerApp("0100000000000000", 60)]
      }]
    })),
    /未出现在日报 playedApps 中/u
  );
});

test("nxapi aggregation prefers final summaries and rounds only after accumulating seconds", () => {
  const makeOneGameDay = (
    date: string,
    result: "ACHIEVED" | "CALCULATING",
    updatedAt: number,
    seconds: number,
    title: string
  ) => parseNxapiParentalDailySummary(nxapiDailyFixture({
    date,
    result,
    updatedAt,
    playingTime: seconds,
    playedApps: [nxapiTitle(ZELDA_ID, title)],
    anonymousPlayer: null,
    devicePlayers: [{
      playingTime: seconds,
      playedApps: [nxapiPlayerApp(ZELDA_ID, seconds)]
    }]
  }));

  const staleCalculating = makeOneGameDay("2026-07-17", "CALCULATING", 300, 120, "古いタイトル");
  const finalDay = makeOneGameDay("2026-07-17", "ACHIEVED", 200, 30, "ゼルダの伝説");
  const nextDay = makeOneGameDay("2026-07-18", "ACHIEVED", 400, 30, "ゼルダの伝説 TotK");
  const aggregated = aggregateNxapiDailySummaries([staleCalculating, finalDay, nextDay]);

  assert.deepEqual(aggregated, {
    locale: "ja-JP",
    games: [{
      title: "ゼルダの伝説 TotK",
      externalId: ZELDA_ID,
      playMinutes: 1,
      firstPlayed: "2026-07-01",
      lastPlayed: "2026-07-18",
      system: "switch",
      ownership: "played",
      coverUrl: COVER
    }]
  });
});
