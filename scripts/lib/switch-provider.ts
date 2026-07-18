import { createHash } from "node:crypto";
import type { GameRecord } from "../../src/types/library";
import {
  canonicalIdForGame,
  emptyAchievements,
  emptyStore,
  type CanonicalAliases
} from "../../src/utils/library";
import type { ProviderSnapshot } from "./assemble-snapshot";
import type { SwitchImportBatch, SwitchImportRecord } from "./switch-import";

export interface BuildSwitchProviderOptions {
  batch: SwitchImportBatch;
  displayName?: string;
  accountId?: string;
  device?: string;
  aliases?: CanonicalAliases;
  now?: () => Date;
}

function timestamp(value: string): {
  value: string;
  precision: NonNullable<GameRecord["lastPlayedPrecision"]>;
} {
  return value.length === 10
    ? { value: `${value}T00:00:00.000Z`, precision: "date" }
    : { value: new Date(value).toISOString(), precision: "datetime" };
}

function stableExternalId(game: SwitchImportRecord): string {
  if (game.externalId) return game.externalId;
  const identity = `${game.system}\0${game.title.normalize("NFKC").toLocaleLowerCase("ja-JP")}`;
  const digest = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 16);
  return `manual-${digest}`;
}

function toGame(game: SwitchImportRecord, aliases: CanonicalAliases): GameRecord {
  const externalId = stableExternalId(game);
  const store = emptyStore();
  store.platforms = [game.system];
  if (game.coverUrl) store.headerImageUrl = game.coverUrl;
  const playtime: GameRecord["playtime"] = {};
  if (game.playMinutes !== undefined) playtime.totalMinutes = game.playMinutes;

  const record: GameRecord = {
    id: `switch:${externalId}`,
    canonicalId: canonicalIdForGame("switch", externalId, game.title, aliases),
    source: "switch",
    externalId,
    name: game.title,
    ownership: game.ownership,
    playtime,
    achievements: emptyAchievements("unsupported"),
    store,
    links: {}
  };
  if (game.coverUrl) record.iconUrl = game.coverUrl;
  if (game.lastPlayed) {
    const activity = timestamp(game.lastPlayed);
    record.lastPlayedAt = activity.value;
    record.lastPlayedPrecision = activity.precision;
  }
  return record;
}

/** Maps a sanitized manual or nxapi-derived import batch into the public snapshot. */
export function buildSwitchProvider(options: BuildSwitchProviderOptions): ProviderSnapshot {
  const aliases = options.aliases ?? {};
  const syncedAt = (options.now ?? (() => new Date()))().toISOString();
  const games = options.batch.games
    .map((game) => toGame(game, aliases))
    .sort((left, right) => left.externalId.localeCompare(right.externalId, "en"));

  return {
    account: {
      source: "switch",
      status: games.length > 0 ? "ready" : "empty",
      profile: {
        externalId: options.accountId?.trim() || "switch-local",
        displayName: options.displayName?.trim() || "Nintendo Switch",
        region: options.batch.locale,
        device: options.device?.trim() || "Nintendo Switch Lite"
      },
      lastSyncedAt: syncedAt
    },
    games
  };
}
