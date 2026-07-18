import assert from "node:assert/strict";
import test from "node:test";
import { assembleSnapshot, type ProviderSnapshot } from "../scripts/lib/assemble-snapshot";
import { collectProviderSnapshots } from "../scripts/lib/provider-runner";
import { canonicalIdForGame, emptyAchievements, emptyStore } from "../src/utils/library";

function emptyProvider(source: ProviderSnapshot["account"]["source"]): ProviderSnapshot {
  return { account: { source, status: "empty" }, games: [] };
}

function steamProviderWithGame(): ProviderSnapshot {
  return {
    account: { source: "steam", status: "ready" },
    games: [{
      id: "steam:1",
      canonicalId: canonicalIdForGame("steam", "1", "Available Game"),
      source: "steam",
      externalId: "1",
      name: "Available Game",
      ownership: "played",
      playtime: { totalMinutes: 60 },
      achievements: emptyAchievements(),
      store: emptyStore(),
      links: {}
    }]
  };
}

test("one provider failure becomes a static unavailable account while peers continue", async () => {
  const warnings: string[] = [];
  const result = await collectProviderSnapshots([
    {
      source: "steam",
      configured: true,
      run: async () => steamProviderWithGame()
    },
    {
      source: "xbox",
      configured: true,
      run: async () => {
        throw new Error("secret-token-and-untrusted-upstream-payload");
      }
    },
    {
      source: "epic",
      configured: false,
      run: async () => emptyProvider("epic")
    }
  ], (source) => warnings.push(source));

  assert.equal(result.configuredCount, 2);
  assert.equal(result.successfulCount, 1);
  assert.deepEqual(result.failedSources, ["xbox"]);
  assert.deepEqual(warnings, ["xbox"]);
  assert.equal(result.providers[0]?.account.status, "ready");
  assert.deepEqual(result.providers[1], {
    account: {
      source: "xbox",
      status: "unavailable",
      message: "本次同步失败，其他平台仍会继续更新"
    },
    games: []
  });
  assert.doesNotMatch(JSON.stringify(result), /secret-token|upstream-payload/u);

  const snapshot = assembleSnapshot(result.providers, "2026-07-19T00:00:00.000Z");
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.accounts.find((account) => account.source === "steam")?.status, "ready");
  assert.equal(snapshot.accounts.find((account) => account.source === "xbox")?.status, "unavailable");
});

test("configured providers returning no snapshot are isolated as failures", async () => {
  const result = await collectProviderSnapshots([
    { source: "epic", configured: true, run: async () => undefined },
    { source: "switch", configured: false, run: async () => emptyProvider("switch") }
  ], () => undefined);

  assert.equal(result.configuredCount, 1);
  assert.equal(result.successfulCount, 0);
  assert.deepEqual(result.failedSources, ["epic"]);
  assert.equal(result.providers[0]?.account.source, "epic");
  assert.equal(result.providers[0]?.account.status, "unavailable");
});

test("provider-specific schema collisions do not block valid peers", async () => {
  const duplicateEpic: ProviderSnapshot = {
    account: { source: "epic", status: "ready" },
    games: ["first", "second"].map((externalId) => ({
      id: `epic:${externalId}`,
      canonicalId: canonicalIdForGame("epic", externalId, "Duplicate Title"),
      source: "epic" as const,
      externalId,
      name: "Duplicate Title",
      ownership: "owned" as const,
      playtime: {},
      achievements: emptyAchievements(),
      store: emptyStore(),
      links: {}
    }))
  };
  const result = await collectProviderSnapshots([
    { source: "steam", configured: true, run: async () => steamProviderWithGame() },
    { source: "epic", configured: true, run: async () => duplicateEpic }
  ], () => undefined);

  assert.equal(result.successfulCount, 1);
  assert.deepEqual(result.failedSources, ["epic"]);
  assert.equal(result.providers.find((provider) => provider.account.source === "epic")?.account.status, "unavailable");
  assert.equal(assembleSnapshot(result.providers, "2026-07-19T00:00:00.000Z").status, "partial");
});
