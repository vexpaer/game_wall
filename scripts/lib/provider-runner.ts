import type { GameSource } from "../../src/types/library";
import type { ProviderSnapshot } from "./assemble-snapshot";

export interface ProviderDefinition {
  source: GameSource;
  configured: boolean;
  run: () => Promise<ProviderSnapshot | undefined>;
}

export interface ProviderCollection {
  providers: ProviderSnapshot[];
  configuredCount: number;
  successfulCount: number;
  failedSources: GameSource[];
}

const UNAVAILABLE_MESSAGE = "本次同步失败，其他平台仍会继续更新";

function unavailableProvider(source: GameSource): ProviderSnapshot {
  return {
    account: {
      source,
      status: "unavailable",
      message: UNAVAILABLE_MESSAGE
    },
    games: []
  };
}

/**
 * Provider exceptions are external integration failures, not snapshot failures.
 * Error objects are intentionally discarded so credentials or upstream payloads
 * cannot be copied into logs or the public snapshot.
 */
export async function collectProviderSnapshots(
  definitions: readonly ProviderDefinition[],
  onFailure: (source: GameSource) => void = (source) => {
    console.warn(`平台同步降级：${source} 本次不可用，继续处理其他平台`);
  }
): Promise<ProviderCollection> {
  const settled = await Promise.all(definitions.map(async (definition) => {
    if (!definition.configured) {
      return { configured: false, succeeded: false } as const;
    }
    try {
      const provider = await definition.run();
      if (provider) {
        return { configured: true, succeeded: true, provider } as const;
      }
    } catch {
      // Deliberately discard provider errors; callers receive a static status.
    }
    onFailure(definition.source);
    return {
      configured: true,
      succeeded: false,
      provider: unavailableProvider(definition.source)
    } as const;
  }));

  return {
    providers: settled
      .map((result) => result.provider)
      .filter((provider): provider is ProviderSnapshot => provider !== undefined),
    configuredCount: settled.filter((result) => result.configured).length,
    successfulCount: settled.filter((result) => result.succeeded).length,
    failedSources: definitions
      .filter((_, index) => settled[index]?.configured && !settled[index]?.succeeded)
      .map((definition) => definition.source)
  };
}
