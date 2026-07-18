import type { GameRecord, GameSource, SiteSnapshot, SourceAccount } from "../../src/types/library";
import { gameSources } from "../../src/types/library";
import {
  hasAmbiguousSameSourceTitleCollision,
  snapshotStatus,
  summarizeLibrary
} from "../../src/utils/library";
import { assertSiteSnapshot } from "./schema";

export interface ProviderSnapshot {
  account: SourceAccount;
  games: GameRecord[];
}

function notConfigured(source: GameSource): SourceAccount {
  return { source, status: "not_configured" };
}

export function assembleSnapshot(
  providers: readonly ProviderSnapshot[],
  generatedAt = new Date().toISOString()
): SiteSnapshot {
  const bySource = new Map<GameSource, ProviderSnapshot>();
  for (const provider of providers) {
    const source = provider.account.source;
    if (!gameSources.includes(source)) {
      throw new TypeError("provider.account.source 不是受支持的平台");
    }
    if (bySource.has(source)) {
      throw new TypeError(`平台 ${source} 出现了重复 provider`);
    }
    if (provider.games.some((game) => game.source !== source)) {
      throw new TypeError(`平台 ${source} 的 provider 包含来源不匹配的游戏记录`);
    }
    bySource.set(source, provider);
  }
  const accounts = gameSources.map((source) => bySource.get(source)?.account ?? notConfigured(source));
  const games = gameSources.flatMap((source) => bySource.get(source)?.games ?? [])
    .sort((left, right) => {
      const sourceDifference = gameSources.indexOf(left.source) - gameSources.indexOf(right.source);
      return sourceDifference || left.externalId.localeCompare(right.externalId, "en");
    });
  if (hasAmbiguousSameSourceTitleCollision(games)) {
    throw new TypeError("同一平台存在无法自动区分的同名游戏；请用 aliases.records 显式拆分");
  }
  const snapshot: SiteSnapshot = {
    schemaVersion: 2,
    status: snapshotStatus(accounts, games),
    generatedAt,
    accounts,
    summary: summarizeLibrary(games),
    games
  };
  assertSiteSnapshot(snapshot);
  return snapshot;
}
