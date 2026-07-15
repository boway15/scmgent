import { eq, inArray, or, type AnyColumn, type SQL } from 'drizzle-orm';
import { normalizeSalesPlatform } from './forecast-demand.js';

/** V4.1 已定义分层规则的平台（AMAZON + 非亚马逊 T3P 渠道） */
export const FORECAST_V41_PLATFORM_CODES = [
  'AMAZON',
  'WALMART',
  'TEMU',
  'TIKTOK',
  'UNKNOWN',
] as const;

export type ForecastV41PlatformCode = (typeof FORECAST_V41_PLATFORM_CODES)[number];

const V41_PLATFORM_SET = new Set<string>(FORECAST_V41_PLATFORM_CODES);

/** 用户选择全平台 / ALL 时展开为 V4.1 支持的分平台列表 */
export function resolveBaselineForecastPlatforms(raw?: string | null): string[] {
  const normalized = normalizeSalesPlatform(raw);
  if (!raw?.trim() || normalized === 'ALL') {
    return [...FORECAST_V41_PLATFORM_CODES];
  }
  return [normalized];
}

export function countBaselineForecastPlatforms(raw?: string | null): number {
  return resolveBaselineForecastPlatforms(raw).length;
}

export function isForecastV41PlatformCode(code: string): boolean {
  return V41_PLATFORM_SET.has(code.trim().toUpperCase());
}

/** purge / 查询：platform=ALL 语义 → V4.1 分平台列表 */
export function resolveForecastPlatformFilter(raw?: string | null): string[] | undefined {
  const normalized = normalizeSalesPlatform(raw);
  if (!raw?.trim()) return undefined;
  if (normalized === 'ALL') return [...FORECAST_V41_PLATFORM_CODES];
  return [normalized];
}

/** 查询条件：ALL 展开为 V4.1 分平台（兼容遗留 platform=ALL 行） */
export function forecastPlatformCondition(
  platformColumn: AnyColumn,
  raw?: string | null,
): SQL | undefined {
  const platformFilter = resolveForecastPlatformFilter(raw);
  if (!platformFilter) return undefined;
  if (platformFilter.length === 1) {
    return eq(platformColumn, platformFilter[0]!);
  }
  return or(
    inArray(platformColumn, platformFilter),
    eq(platformColumn, 'ALL'),
  )!;
}
