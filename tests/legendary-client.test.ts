import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEGENDARY_LIST_ARGUMENTS,
  LegendaryClient,
  legendaryChildEnvironment,
  parseLegendaryList,
  type LegendaryCommandRunner
} from "../scripts/lib/legendary-client";

test("Legendary receives a minimal environment without unrelated provider secrets", () => {
  const environment = legendaryChildEnvironment({
    PATH: "/fixture/bin",
    HOME: "/fixture/home",
    LEGENDARY_CONFIG_PATH: "/fixture/legendary",
    STEAM_API_KEY: "steam-secret",
    OPENXBL_API_KEY: "xbox-secret",
    GAME_WALL_STATE_KEY: "state-secret",
    GITHUB_TOKEN: "github-secret"
  });

  assert.equal(environment.PATH, "/fixture/bin");
  assert.equal(environment.HOME, "/fixture/home");
  assert.equal(environment.LEGENDARY_CONFIG_PATH, "/fixture/legendary");
  assert.equal(environment.PYTHONIOENCODING, "utf-8");
  assert.equal(environment.PYTHONUTF8, "1");
  assert.equal(environment.STEAM_API_KEY, undefined);
  assert.equal(environment.OPENXBL_API_KEY, undefined);
  assert.equal(environment.GAME_WALL_STATE_KEY, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
});

test("Legendary list JSON becomes base games and flattened DLC records", () => {
  const games = parseLegendaryList(JSON.stringify([
    {
      app_name: "Fortnite",
      app_title: "Fortnite",
      asset_infos: {
        Windows: {
          app_name: "Fortnite",
          catalog_item_id: "fortnite-catalog",
          namespace: "fn"
        }
      },
      metadata: {
        id: "fortnite-catalog",
        namespace: "fn",
        categories: [{ path: "games" }]
      },
      dlcs: [
        {
          app_name: "FortniteAddon",
          app_title: "Fortnite Add-on",
          metadata: {
            id: "fortnite-addon",
            namespace: "fn",
            mainGameItem: { id: "fortnite-catalog" }
          }
        }
      ]
    }
  ]));

  assert.deepEqual(games, [
    {
      source: "epic",
      externalId: "fn:fortnite-catalog",
      title: "Fortnite",
      appName: "Fortnite",
      catalogItemId: "fortnite-catalog",
      namespace: "fn",
      kind: "game",
      owned: true,
      thirdParty: false
    },
    {
      source: "epic",
      externalId: "fn:fortnite-addon",
      title: "Fortnite Add-on",
      appName: "FortniteAddon",
      catalogItemId: "fortnite-addon",
      namespace: "fn",
      kind: "dlc",
      owned: true,
      thirdParty: false
    }
  ]);
});

test("third-party metadata, camelCase variants, installs, and missing optional fields are tolerated", () => {
  const games = parseLegendaryList(`\uFEFF${JSON.stringify({
    games: [
      {
        appName: "OriginGame",
        title: "EA Fixture",
        catalogItemId: "ea-catalog",
        namespace: "ea",
        metadata: {
          customAttributes: {
            ThirdPartyManagedApp: { type: "STRING", value: "true" },
            ThirdPartyManagedAppService: { type: "STRING", value: "Origin" }
          }
        },
        installation: { installed: true, path: "C:\\Games\\EA Fixture" }
      },
      {
        app_name: "NameOnly",
        is_installed: false
      },
      {
        catalog_item_id: "catalog-only"
      },
      { app_title: "No usable identifier" },
      null
    ]
  })}`);

  assert.deepEqual(games, [
    {
      source: "epic",
      externalId: "ea:ea-catalog",
      title: "EA Fixture",
      appName: "OriginGame",
      catalogItemId: "ea-catalog",
      namespace: "ea",
      kind: "game",
      owned: true,
      thirdParty: true,
      install: { installed: true, installPath: "C:\\Games\\EA Fixture" }
    },
    {
      source: "epic",
      externalId: "NameOnly",
      title: "NameOnly",
      appName: "NameOnly",
      kind: "game",
      owned: true,
      thirdParty: false,
      install: { installed: false }
    },
    {
      source: "epic",
      externalId: "catalog-only",
      title: "catalog-only",
      catalogItemId: "catalog-only",
      kind: "game",
      owned: true,
      thirdParty: false
    }
  ]);
});

test("third-party status propagates to nested DLC and duplicate DLC IDs win", () => {
  const games = parseLegendaryList(JSON.stringify([
    {
      appName: "PartnerBase",
      appTitle: "Partner Base",
      thirdPartyStore: "Ubisoft Connect",
      dlcs: [{ appName: "Shared", appTitle: "Partner DLC" }]
    },
    { appName: "Shared", appTitle: "Duplicate top-level record" }
  ]));

  assert.equal(games.length, 2);
  assert.deepEqual(games[1], {
    source: "epic",
    externalId: "Shared",
    title: "Partner DLC",
    appName: "Shared",
    kind: "dlc",
    owned: true,
    thirdParty: true
  });
});

test("the client invokes only the fixed Legendary list argument vector", async () => {
  let calls = 0;
  const runner: LegendaryCommandRunner = async (request) => {
    calls += 1;
    assert.equal(request.executable, "legendary-fixture");
    assert.equal(request.timeoutMs, 42_000);
    assert.deepEqual(request.args, ["list", "--third-party", "--json", "--force-refresh"]);
    assert.equal(request.args, LEGENDARY_LIST_ARGUMENTS);
    return {
      exitCode: 0,
      stdout: JSON.stringify([{ app_name: "Fixture", app_title: "Fixture Game" }])
    };
  };

  const client = new LegendaryClient({ executable: "legendary-fixture", runner, timeoutMs: 42_000 });
  assert.equal((await client.listGames())[0]?.title, "Fixture Game");
  assert.equal(calls, 1);
});

test("invalid JSON and subprocess failures never expose credential-like output", async () => {
  const secret = "refresh_token-never-print-this";
  assert.throws(
    () => parseLegendaryList(`{\"user.json\":\"${secret}\"`),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /refresh_token|never-print|user\.json/u);
      return true;
    }
  );

  const failed = new LegendaryClient({
    runner: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ access_token: secret, file: "user.json" })
    })
  });
  await assert.rejects(failed.listGames(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /refresh_token|never-print|user\.json|access_token/u);
    return true;
  });

  const threw = new LegendaryClient({
    runner: async () => {
      throw new Error(`user.json contained ${secret}`);
    }
  });
  await assert.rejects(threw.listGames(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /refresh_token|never-print|user\.json/u);
    return true;
  });
});
