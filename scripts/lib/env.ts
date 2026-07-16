import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LoadEnvOptions {
  cwd?: string;
  fileName?: string;
  env?: NodeJS.ProcessEnv;
}

function parseValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length < 2) return value;

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    const unquoted = value.slice(1, -1);
    if (quote === "'") return unquoted;
    return unquoted
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  const comment = value.search(/\s+#/);
  return comment === -1 ? value : value.slice(0, comment).trimEnd();
}

export function parseEnv(source: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key !== undefined && rawValue !== undefined) parsed[key] = parseValue(rawValue);
  }

  return parsed;
}

/** Loads a local .env without replacing values already supplied by the shell. */
export function loadLocalEnv(options: LoadEnvOptions = {}): Record<string, string> {
  const env = options.env ?? process.env;
  const path = resolve(options.cwd ?? process.cwd(), options.fileName ?? ".env");
  if (!existsSync(path)) return {};

  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
  return parsed;
}

export function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`缺少必需环境变量 ${name}`);
  return value;
}
