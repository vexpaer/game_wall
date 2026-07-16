import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StoreMetadata } from "../../src/types/steam";
import { assertStoreMetadata } from "./schema";

interface CacheEntry {
  cachedAt: string;
  data: StoreMetadata;
}

interface StoreCacheFile {
  schemaVersion: 1;
  language: string;
  entries: Record<string, CacheEntry>;
}

function emptyCache(language: string): StoreCacheFile {
  return { schemaVersion: 1, language, entries: {} };
}

export class StoreCache {
  private readonly path: string;
  private readonly language: string;
  private readonly ttlMs: number;
  private readonly now: () => Date;
  private data: StoreCacheFile;
  private dirty = false;

  constructor(
    path: string,
    language: string,
    options: { ttlMs?: number; now?: () => Date } = {}
  ) {
    this.path = path;
    this.language = language;
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1_000;
    this.now = options.now ?? (() => new Date());
    this.data = this.read();
  }

  private read(): StoreCacheFile {
    if (!existsSync(this.path)) return emptyCache(this.language);
    try {
      const candidate = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
        return emptyCache(this.language);
      }
      const root = candidate as Record<string, unknown>;
      if (root.schemaVersion !== 1 || root.language !== this.language) {
        return emptyCache(this.language);
      }
      if (typeof root.entries !== "object" || root.entries === null || Array.isArray(root.entries)) {
        return emptyCache(this.language);
      }

      const result = emptyCache(this.language);
      for (const [appId, rawEntry] of Object.entries(root.entries)) {
        if (!/^\d+$/u.test(appId) || typeof rawEntry !== "object" || rawEntry === null) continue;
        const entry = rawEntry as Record<string, unknown>;
        if (typeof entry.cachedAt !== "string" || Number.isNaN(Date.parse(entry.cachedAt))) continue;
        try {
          assertStoreMetadata(entry.data, `cache.entries.${appId}.data`);
          result.entries[appId] = { cachedAt: entry.cachedAt, data: entry.data };
        } catch {
          // Ignore only the corrupt entry; other cached app metadata remains usable.
        }
      }
      return result;
    } catch {
      return emptyCache(this.language);
    }
  }

  get(appId: number): StoreMetadata | undefined {
    const entry = this.data.entries[String(appId)];
    if (!entry) return undefined;
    const age = this.now().getTime() - Date.parse(entry.cachedAt);
    if (age > this.ttlMs) return undefined;
    return entry.data;
  }

  set(appId: number, data: StoreMetadata): void {
    assertStoreMetadata(data);
    this.data.entries[String(appId)] = { cachedAt: this.now().toISOString(), data };
    this.dirty = true;
  }

  save(): void {
    if (!this.dirty) return;
    const entries = Object.fromEntries(
      Object.entries(this.data.entries).sort(([left], [right]) => Number(left) - Number(right))
    );
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `${JSON.stringify({ schemaVersion: 1, language: this.language, entries }, null, 2)}\n`,
      "utf8"
    );
    this.dirty = false;
  }
}
