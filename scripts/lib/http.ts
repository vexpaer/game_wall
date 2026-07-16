export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type Sleep = (milliseconds: number) => Promise<void>;

export interface RequestJsonOptions {
  fetch?: FetchLike;
  headers?: HeadersInit;
  timeoutMs?: number;
  retries?: number;
  sleep?: Sleep;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly payload: unknown;

  constructor(status: number, url: string, payload: unknown) {
    super(`HTTP ${status}: ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.payload = payload;
  }
}

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function requestJson(
  url: string | URL,
  options: RequestJsonOptions = {}
): Promise<unknown> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  const safeUrl = new URL(url).toString();

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const init: RequestInit = { signal: controller.signal };
      if (options.headers !== undefined) init.headers = options.headers;
      const response = await fetcher(safeUrl, init);
      const payload = await readPayload(response);

      if (response.ok) return payload;

      const error = new HttpError(response.status, safeUrl, payload);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;

      if (attempt < retries) {
        const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"));
        await sleep(retryAfter ?? 500 * 2 ** attempt);
      }
    } catch (error) {
      if (error instanceof HttpError && error.status !== 429 && error.status < 500) throw error;
      lastError = error;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`请求在重试后仍失败：${safeUrl}（${detail}）`, { cause: lastError });
}
