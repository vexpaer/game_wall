import { spawn } from "node:child_process";

export const LEGENDARY_LIST_ARGUMENTS = Object.freeze([
  "list",
  "--third-party",
  "--json",
  "--force-refresh"
] as const);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

// The sync job also holds Steam/OpenXBL/state secrets. Legendary needs only its
// own config path and ordinary process/runtime variables, so do not inherit the
// complete Actions environment into this third-party subprocess.
const LEGENDARY_ENVIRONMENT_KEYS = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LEGENDARY_CONFIG_PATH",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TZ",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME"
]);

export function legendaryChildEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && LEGENDARY_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  environment.PYTHONIOENCODING = "utf-8";
  environment.PYTHONUTF8 = "1";
  return environment;
}

export interface EpicRawGame {
  source: "epic";
  externalId: string;
  title: string;
  appName?: string;
  catalogItemId?: string;
  namespace?: string;
  kind: "game" | "dlc" | "other";
  owned: boolean;
  thirdParty: boolean;
  install?: {
    installed: boolean;
    installPath?: string;
  };
}

export interface LegendaryCommandRequest {
  executable: string;
  args: readonly string[];
  timeoutMs: number;
}

export interface LegendaryCommandResult {
  exitCode: number;
  stdout: string;
}

export type LegendaryCommandRunner = (
  request: Readonly<LegendaryCommandRequest>
) => Promise<LegendaryCommandResult>;

export interface LegendaryClientOptions {
  executable?: string;
  runner?: LegendaryCommandRunner;
  timeoutMs?: number;
}

/**
 * Errors intentionally contain no subprocess output. Legendary's diagnostics can
 * mention its credential store, so callers must not forward stdout/stderr.
 */
export class LegendaryClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegendaryClientError";
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function textAt(source: UnknownRecord | undefined, ...keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = nonEmptyText(source[key]);
    if (value) return value;
  }
  return undefined;
}

function booleanAt(source: UnknownRecord | undefined, ...keys: string[]): boolean | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1"].includes(normalized)) return true;
      if (["false", "no", "0"].includes(normalized)) return false;
    }
  }
  return undefined;
}

function recordsFrom(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const result = record(item);
      return result ? [result] : [];
    });
  }
  const map = record(value);
  if (!map) return [];
  return Object.values(map).flatMap((item) => {
    const result = record(item);
    return result ? [result] : [];
  });
}

function firstAssetInfo(game: UnknownRecord): UnknownRecord | undefined {
  const assetInfos = record(game.asset_infos) ?? record(game.assetInfos);
  if (!assetInfos) return undefined;
  for (const value of Object.values(assetInfos)) {
    const asset = record(value);
    if (asset) return asset;
  }
  return undefined;
}

function firstReleaseInfo(metadata: UnknownRecord | undefined): UnknownRecord | undefined {
  if (!metadata) return undefined;
  return recordsFrom(metadata.releaseInfo ?? metadata.release_info)[0];
}

function catalogIdentifiers(game: UnknownRecord): {
  appName?: string;
  catalogItemId?: string;
  namespace?: string;
} {
  const metadata = record(game.metadata);
  const asset = firstAssetInfo(game);
  const release = firstReleaseInfo(metadata);

  const appName = textAt(game, "app_name", "appName")
    ?? textAt(asset, "app_name", "appName")
    ?? textAt(release, "appId", "app_id");
  const catalogItemId = textAt(game, "catalog_item_id", "catalogItemId")
    ?? textAt(asset, "catalog_item_id", "catalogItemId")
    ?? textAt(metadata, "id", "catalogItemId", "catalog_item_id");
  const namespace = textAt(game, "namespace", "namespaceId", "namespace_id")
    ?? textAt(asset, "namespace", "namespaceId", "namespace_id")
    ?? textAt(metadata, "namespace", "namespaceId", "namespace_id");

  const result: {
    appName?: string;
    catalogItemId?: string;
    namespace?: string;
  } = {};
  if (appName) result.appName = appName;
  if (catalogItemId) result.catalogItemId = catalogItemId;
  if (namespace) result.namespace = namespace;
  return result;
}

function normalizedType(game: UnknownRecord): string | undefined {
  const metadata = record(game.metadata);
  return textAt(game, "app_type", "appType", "type", "kind")
    ?? textAt(metadata, "app_type", "appType", "type", "kind");
}

function categoryPaths(game: UnknownRecord): string[] {
  const metadata = record(game.metadata);
  const rawCategories = metadata?.categories ?? game.categories;
  if (!Array.isArray(rawCategories)) return [];
  return rawCategories.flatMap((rawCategory) => {
    if (typeof rawCategory === "string") return [rawCategory.trim().toLowerCase()];
    const category = record(rawCategory);
    const path = textAt(category, "path", "name", "id");
    return path ? [path.toLowerCase()] : [];
  });
}

function gameKind(game: UnknownRecord, nestedDlc: boolean): EpicRawGame["kind"] {
  if (nestedDlc || booleanAt(game, "is_dlc", "isDlc") === true) return "dlc";

  const metadata = record(game.metadata);
  if (record(metadata?.mainGameItem) || record(metadata?.main_game_item)) return "dlc";

  const type = normalizedType(game)?.toLowerCase();
  if (type && ["dlc", "addon", "add-on", "add_on"].includes(type)) return "dlc";
  if (type && ["application", "software", "tool", "unrealengine", "unreal engine"].includes(type)) {
    return "other";
  }

  const categories = categoryPaths(game);
  if (categories.some((path) => /(^|\/)(addons?|dlc)(\/|$)/u.test(path))) return "dlc";
  if (categories.some((path) => /(^|\/)games?(\/|$)/u.test(path))) return "game";
  return "game";
}

function customAttributes(metadata: UnknownRecord | undefined): Array<[string, unknown]> {
  if (!metadata) return [];
  const attributes = metadata.customAttributes ?? metadata.custom_attributes;
  if (Array.isArray(attributes)) {
    return attributes.flatMap((rawAttribute): Array<[string, unknown]> => {
      const attribute = record(rawAttribute);
      const key = textAt(attribute, "key", "name");
      return key ? [[key, attribute?.value]] : [];
    });
  }
  const attributeMap = record(attributes);
  return attributeMap ? Object.entries(attributeMap) : [];
}

function unwrapAttributeValue(value: unknown): unknown {
  const wrapped = record(value);
  return wrapped && "value" in wrapped ? wrapped.value : value;
}

function truthyThirdPartyAttribute(key: string, value: unknown): boolean {
  const normalizedKey = key.replace(/[^a-z\d]/giu, "").toLowerCase();
  if (!/(thirdparty|partnerlink|origin|ubisoft|uplay|eaapp)/u.test(normalizedKey)) return false;

  const unwrapped = unwrapAttributeValue(value);
  if (typeof unwrapped === "boolean") return unwrapped;
  if (typeof unwrapped === "number") return unwrapped !== 0;
  const text = nonEmptyText(unwrapped)?.toLowerCase();
  return Boolean(text && !["false", "none", "null", "no", "0"].includes(text));
}

function isThirdParty(game: UnknownRecord, inherited: boolean): boolean {
  if (inherited) return true;
  if (booleanAt(game, "third_party", "thirdParty", "is_origin_game", "isOriginGame", "is_ubisoft_game", "isUbisoftGame") === true) {
    return true;
  }
  if (textAt(game, "third_party_store", "thirdPartyStore", "partner_link_type", "partnerLinkType")) {
    return true;
  }

  const metadata = record(game.metadata);
  if (textAt(metadata, "third_party_store", "thirdPartyStore", "partner_link_type", "partnerLinkType")) {
    return true;
  }
  return customAttributes(metadata).some(([key, value]) => truthyThirdPartyAttribute(key, value));
}

function installInfo(game: UnknownRecord): EpicRawGame["install"] | undefined {
  const install = record(game.install) ?? record(game.installation);
  const installPath = textAt(install, "installPath", "install_path", "path")
    ?? textAt(game, "installPath", "install_path");
  const installed = booleanAt(install, "installed", "isInstalled", "is_installed")
    ?? booleanAt(game, "installed", "isInstalled", "is_installed")
    ?? (installPath ? true : undefined);
  if (installed === undefined) return undefined;
  if (!installed || !installPath) return { installed };
  return { installed, installPath };
}

function rawGame(game: UnknownRecord, nestedDlc: boolean, inheritedThirdParty: boolean): EpicRawGame | undefined {
  const identifiers = catalogIdentifiers(game);
  const externalId = identifiers.namespace && identifiers.catalogItemId
    ? `${identifiers.namespace}:${identifiers.catalogItemId}`
    : identifiers.catalogItemId ?? identifiers.appName;
  if (!externalId) return undefined;

  const metadata = record(game.metadata);
  const title = textAt(game, "app_title", "appTitle", "title", "displayName", "display_name")
    ?? textAt(metadata, "title", "displayName", "display_name")
    ?? identifiers.appName
    ?? identifiers.catalogItemId;
  if (!title) return undefined;

  const result: EpicRawGame = {
    source: "epic",
    externalId,
    title,
    kind: gameKind(game, nestedDlc),
    owned: true,
    thirdParty: isThirdParty(game, inheritedThirdParty)
  };
  if (identifiers.appName) result.appName = identifiers.appName;
  if (identifiers.catalogItemId) result.catalogItemId = identifiers.catalogItemId;
  if (identifiers.namespace) result.namespace = identifiers.namespace;
  const install = installInfo(game);
  if (install) result.install = install;
  return result;
}

function rootGames(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) return recordsFrom(payload);
  const root = record(payload);
  if (!root) throw new LegendaryClientError("Legendary 游戏列表的 JSON 结构无效");

  for (const key of ["games", "items", "library", "libraryItems", "library_items"] as const) {
    if (key in root) {
      const games = recordsFrom(root[key]);
      if (games.length > 0 || Array.isArray(root[key]) || record(root[key])) return games;
    }
  }

  if (catalogIdentifiers(root).appName || catalogIdentifiers(root).catalogItemId) return [root];
  throw new LegendaryClientError("Legendary 游戏列表的 JSON 结构无效");
}

/** Parse `legendary list --third-party --json --force-refresh` stdout. */
export function parseLegendaryList(output: string): EpicRawGame[] {
  if (typeof output !== "string" || output.length > MAX_OUTPUT_BYTES) {
    throw new LegendaryClientError("Legendary 游戏列表输出无效或过大");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(output.replace(/^\uFEFF/u, "").trim());
  } catch {
    // JSON.parse errors may contain an excerpt of the input on recent Node versions.
    throw new LegendaryClientError("Legendary 没有返回有效的游戏列表 JSON");
  }

  const parsed: EpicRawGame[] = [];
  for (const game of rootGames(payload)) {
    const base = rawGame(game, false, false);
    if (base) parsed.push(base);

    const inheritedThirdParty = base?.thirdParty ?? isThirdParty(game, false);
    for (const dlc of recordsFrom(game.dlcs ?? game.DLCs ?? game.addons)) {
      const addon = rawGame(dlc, true, inheritedThirdParty);
      if (addon) parsed.push(addon);
    }
  }

  const unique = new Map<string, EpicRawGame>();
  for (const game of parsed) {
    const existing = unique.get(game.externalId);
    if (!existing || (existing.kind !== "dlc" && game.kind === "dlc")) unique.set(game.externalId, game);
  }
  return [...unique.values()];
}

export const runLegendaryCommand: LegendaryCommandRunner = ({ executable, args, timeoutMs }) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stdoutBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const child = spawn(executable, [...args], {
      env: legendaryChildEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new LegendaryClientError(message));
    };

    const timer = setTimeout(() => fail("Legendary 游戏列表命令超时"), timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += data.byteLength;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        fail("Legendary 游戏列表输出无效或过大");
        return;
      }
      stdoutChunks.push(data);
    });
    // Drain diagnostics without retaining them: they may mention credential files.
    child.stderr.resume();
    child.once("error", () => fail("无法启动 Legendary 游戏列表命令"));
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        exitCode: typeof exitCode === "number" ? exitCode : 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8")
      });
    });
  });

export class LegendaryClient {
  private readonly executable: string;
  private readonly runner: LegendaryCommandRunner;
  private readonly timeoutMs: number;

  constructor(options: LegendaryClientOptions = {}) {
    const executable = options.executable?.trim() || "legendary";
    if (executable.includes("\0")) throw new LegendaryClientError("Legendary 可执行文件路径无效");
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new LegendaryClientError("Legendary 命令超时时间无效");
    }
    this.executable = executable;
    this.runner = options.runner ?? runLegendaryCommand;
    this.timeoutMs = timeoutMs;
  }

  async listGames(): Promise<EpicRawGame[]> {
    let result: LegendaryCommandResult;
    try {
      result = await this.runner({
        executable: this.executable,
        args: LEGENDARY_LIST_ARGUMENTS,
        timeoutMs: this.timeoutMs
      });
    } catch {
      throw new LegendaryClientError("Legendary 游戏列表同步失败");
    }

    if (!Number.isInteger(result.exitCode) || result.exitCode !== 0) {
      throw new LegendaryClientError("Legendary 游戏列表同步失败");
    }
    try {
      return parseLegendaryList(result.stdout);
    } catch {
      throw new LegendaryClientError("Legendary 游戏列表响应无效");
    }
  }
}
