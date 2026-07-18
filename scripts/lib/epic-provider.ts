import type { GameRecord } from "../../src/types/library";
import {
  canonicalIdForGame,
  emptyAchievements,
  emptyStore,
  type CanonicalAliases
} from "../../src/utils/library";
import type { ProviderSnapshot } from "./assemble-snapshot";
import type { LegendaryClient } from "./legendary-client";

export interface BuildEpicProviderOptions {
  client: Pick<LegendaryClient, "listGames">;
  displayName?: string;
  aliases?: CanonicalAliases;
  now?: () => Date;
}

/**
 * Convert Legendary's already-authenticated library response into public site
 * data. This layer deliberately has no login, token, or credential-store access.
 */
export async function buildEpicProvider(
  options: BuildEpicProviderOptions
): Promise<ProviderSnapshot> {
  const displayName = options.displayName?.trim() || "Epic Games";
  const externalId = options.displayName?.trim() || "legendary-local";
  const aliases = options.aliases ?? {};
  const syncedAt = (options.now ?? (() => new Date()))().toISOString();
  const rawGames = await options.client.listGames();

  const games: GameRecord[] = rawGames
    .filter((game) => game.kind === "game" && game.owned)
    .sort((left, right) => left.externalId.localeCompare(right.externalId, "en"))
    .map((game) => {
      const store = emptyStore();
      // Legendary's library command represents the PC catalogue; it does not
      // provide sufficiently reliable metadata to infer any other platform.
      store.platforms = ["windows"];

      return {
        id: `epic:${game.externalId}`,
        canonicalId: canonicalIdForGame("epic", game.externalId, game.title, aliases),
        source: "epic",
        externalId: game.externalId,
        name: game.title,
        ownership: "owned",
        // Legendary exposes ownership, not authoritative playtime.
        playtime: {},
        achievements: emptyAchievements("unsupported"),
        store,
        links: {}
      };
    });

  return {
    account: {
      source: "epic",
      status: games.length > 0 ? "ready" : "empty",
      profile: {
        externalId,
        displayName
      },
      lastSyncedAt: syncedAt
    },
    games
  };
}
