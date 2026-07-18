import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { GameSource } from "../src/types/library";
import type { CanonicalAliases } from "../src/utils/library";
import { assembleSnapshot, type ProviderSnapshot } from "./lib/assemble-snapshot";
import { writeSnapshot, buildSteamProvider } from "./lib/build-snapshot";
import { buildEpicProvider } from "./lib/epic-provider";
import { loadLocalEnv } from "./lib/env";
import { LegendaryClient } from "./lib/legendary-client";
import { OpenXblClient } from "./lib/openxbl-client";
import { collectProviderSnapshots, type ProviderDefinition } from "./lib/provider-runner";
import { SteamClient } from "./lib/steam-client";
import { StoreCache } from "./lib/store-cache";
import {
  aggregateNxapiDailySummaries,
  parseNxapiParentalDailySummariesJson,
  parseSwitchImport,
  type SwitchImportBatch,
  type SwitchImportFormat
} from "./lib/switch-import";
import { buildSwitchProvider } from "./lib/switch-provider";
import { buildXboxProvider } from "./lib/xbox-provider";

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function enabled(name: string): boolean {
  return optionalEnv(name) === "true";
}

function aliasesFromFile(): CanonicalAliases {
  const path = resolve(process.cwd(), optionalEnv("GAME_WALL_ALIASES_FILE") ?? "data/game-aliases.json");
  if (!existsSync(path)) return {};
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("游戏别名文件必须是对象");
  }
  const root = value as Record<string, unknown>;
  for (const key of Object.keys(root)) {
    if (!new Set(["records", "titles"]).has(key)) throw new TypeError(`游戏别名文件包含未知字段 ${key}`);
  }
  const parseMap = (candidate: unknown, path: string): Record<string, string> | undefined => {
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new TypeError(`${path} 必须是字符串映射`);
    }
    const result: Record<string, string> = {};
    for (const [key, mapped] of Object.entries(candidate as Record<string, unknown>)) {
      if (!key.trim() || typeof mapped !== "string" || !mapped.trim()) {
        throw new TypeError(`${path}.${key} 必须是非空字符串`);
      }
      result[key] = mapped;
    }
    return result;
  };
  const result: CanonicalAliases = {};
  const records = parseMap(root.records, "aliases.records");
  const titles = parseMap(root.titles, "aliases.titles");
  if (records) result.records = records;
  if (titles) result.titles = titles;
  return result;
}

function cacheForSteam(): StoreCache {
  const language = optionalEnv("STEAM_LANGUAGE") ?? "schinese";
  const safeLanguage = language.replace(/[^a-z0-9_-]/giu, "_");
  const cachePath = optionalEnv("GAME_WALL_STORE_CACHE")
    ? resolve(process.cwd(), optionalEnv("GAME_WALL_STORE_CACHE") as string)
    : resolve(
        process.cwd(),
        optionalEnv("STEAM_STORE_CACHE_DIR") ?? "data/cache/store",
        `store-${safeLanguage}.json`
      );
  const ttl = Number(optionalEnv("STEAM_STORE_CACHE_TTL_MS") ?? 7 * 24 * 60 * 60 * 1_000);
  if (!Number.isFinite(ttl) || ttl < 0) throw new Error("STEAM_STORE_CACHE_TTL_MS 必须是非负数字");
  return new StoreCache(cachePath, language, { ttlMs: ttl });
}

async function steamProvider(aliases: CanonicalAliases, now: Date): Promise<ProviderSnapshot | undefined> {
  const apiKey = optionalEnv("STEAM_API_KEY");
  const steamUser = optionalEnv("STEAM_USER");
  if (!apiKey && !steamUser) return undefined;
  if (!apiKey || !steamUser) throw new Error("Steam 已部分配置；STEAM_API_KEY 与 STEAM_USER 必须同时提供");
  const language = optionalEnv("STEAM_LANGUAGE") ?? "schinese";
  return buildSteamProvider({
    client: new SteamClient({ apiKey, language }),
    steamUser,
    storeCache: cacheForSteam(),
    aliases,
    now: () => now
  });
}

async function xboxProvider(aliases: CanonicalAliases, now: Date): Promise<ProviderSnapshot | undefined> {
  const apiKey = optionalEnv("OPENXBL_API_KEY");
  if (!apiKey) return undefined;
  return buildXboxProvider({ client: new OpenXblClient({ apiKey }), aliases, now: () => now });
}

async function epicProvider(aliases: CanonicalAliases, now: Date): Promise<ProviderSnapshot | undefined> {
  if (!enabled("EPIC_SYNC_ENABLED")) return undefined;
  const executable = optionalEnv("LEGENDARY_EXECUTABLE");
  const client = executable ? new LegendaryClient({ executable }) : new LegendaryClient();
  const options: Parameters<typeof buildEpicProvider>[0] = {
    client,
    aliases,
    now: () => now
  };
  const displayName = optionalEnv("EPIC_DISPLAY_NAME");
  if (displayName) options.displayName = displayName;
  return buildEpicProvider(options);
}

function loadSwitchBatch(path: string): SwitchImportBatch {
  const source = readFileSync(path, "utf8");
  const configured = optionalEnv("SWITCH_IMPORT_FORMAT")?.toLocaleLowerCase("en-US");
  if (configured === "nxapi") {
    return aggregateNxapiDailySummaries(parseNxapiParentalDailySummariesJson(source, {
      locale: optionalEnv("SWITCH_LOCALE") ?? "ja-JP",
      defaultSystem: "switch"
    }));
  }
  const inferred = extname(path).toLocaleLowerCase("en-US") === ".csv" ? "csv" : "json";
  const format = (configured ?? inferred) as SwitchImportFormat;
  if (!new Set<SwitchImportFormat>(["json", "csv"]).has(format)) {
    throw new Error("SWITCH_IMPORT_FORMAT 必须是 json、csv 或 nxapi");
  }
  return parseSwitchImport(source, format, {
    locale: optionalEnv("SWITCH_LOCALE") ?? "ja-JP",
    defaultSystem: "switch"
  });
}

function switchProvider(aliases: CanonicalAliases, now: Date): ProviderSnapshot | undefined {
  const configuredPath = optionalEnv("SWITCH_IMPORT_FILE");
  if (!configuredPath) return undefined;
  const path = resolve(process.cwd(), configuredPath);
  if (!existsSync(path)) throw new Error(`找不到 Switch 导入文件：${path}`);
  const options: Parameters<typeof buildSwitchProvider>[0] = {
    batch: loadSwitchBatch(path),
    device: optionalEnv("SWITCH_DEVICE") ?? "Nintendo Switch Lite",
    aliases,
    now: () => now
  };
  const displayName = optionalEnv("SWITCH_DISPLAY_NAME");
  const accountId = optionalEnv("SWITCH_ACCOUNT_ID");
  if (displayName) options.displayName = displayName;
  if (accountId) options.accountId = accountId;
  return buildSwitchProvider(options);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const now = new Date();
  const aliases = aliasesFromFile();
  const definitions: ProviderDefinition[] = [
    {
      source: "steam",
      configured: Boolean(optionalEnv("STEAM_API_KEY") || optionalEnv("STEAM_USER")),
      run: () => steamProvider(aliases, now)
    },
    {
      source: "xbox",
      configured: Boolean(optionalEnv("OPENXBL_API_KEY")),
      run: () => xboxProvider(aliases, now)
    },
    {
      source: "epic",
      configured: enabled("EPIC_SYNC_ENABLED"),
      run: () => enabled("EPIC_PROVIDER_UNAVAILABLE")
        ? Promise.resolve(undefined)
        : epicProvider(aliases, now)
    },
    {
      source: "switch",
      configured: Boolean(optionalEnv("SWITCH_IMPORT_FILE")) || enabled("SWITCH_SYNC_CONFIGURED"),
      run: () => enabled("SWITCH_PROVIDER_UNAVAILABLE")
        ? Promise.resolve(undefined)
        : Promise.resolve(switchProvider(aliases, now))
    }
  ];
  const collection = await collectProviderSnapshots(definitions);
  if (collection.configuredCount === 0) {
    throw new Error("没有配置任何游戏平台；请先按 README 设置 Actions Secrets/Variables");
  }
  if (collection.successfulCount === 0) {
    throw new Error("所有已配置游戏平台本次同步均失败");
  }
  const snapshot = assembleSnapshot(collection.providers, now.toISOString());
  const outputPath = resolve(
    process.cwd(),
    optionalEnv("GAME_WALL_DATA_FILE") ?? "data/generated/site-snapshot.json"
  );
  writeSnapshot(outputPath, snapshot);
  const sources = collection.providers.map((provider) => provider.account.source as GameSource).join(" / ");
  const degraded = collection.failedSources.length > 0
    ? `；降级平台：${collection.failedSources.join(" / ")}`
    : "";
  console.log(`多平台同步完成：${sources}，${snapshot.summary.uniqueGames} 款唯一游戏，${snapshot.summary.platformRecords} 条平台记录${degraded}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知错误";
  console.error(`多平台同步失败：${message}`);
  process.exitCode = 1;
});
