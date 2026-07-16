import { siteConfig } from "../config/site";

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 小时";
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  return `${hours >= 100 ? Math.round(hours) : hours.toFixed(1)} 小时`;
}

export function formatDate(value: string | undefined, includeTime = false): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  return new Intl.DateTimeFormat(siteConfig.language, {
    timeZone: siteConfig.timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

export function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}
