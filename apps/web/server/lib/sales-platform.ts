import { eq } from 'drizzle-orm';
import { db, salesPlatforms, salesPlatformAliases } from '@scm/db';

const STATIC_ALIASES: Record<string, string> = {
  亚马逊: 'AMAZON',
  沃尔玛: 'WALMART',
  独立站: 'DTC',
  全平台: 'ALL',
  AMZ: 'AMAZON',
  AMAZON: 'AMAZON',
  'AMAZON.COM': 'AMAZON',
  'AMAZON US': 'AMAZON',
  'AMAZON-US': 'AMAZON',
  WALMART: 'WALMART',
  WM: 'WALMART',
  EBAY: 'EBAY',
  SHOPIFY: 'SHOPIFY',
  DTC: 'DTC',
  TEMU: 'TEMU',
  TIKTOK: 'TIKTOK',
  TT: 'TIKTOK',
  'TIK TOK': 'TIKTOK',
  'TIKTOK SHOP': 'TIKTOK',
  ALL: 'ALL',
  未知: 'UNKNOWN',
  UNKNOWN: 'UNKNOWN',
};

/** 导入批次 UNKNOWN 渠道占比告警阈值（0–1） */
export const SALES_IMPORT_UNKNOWN_CHANNEL_WARN_RATIO = 0.05;

let aliasCache: Map<string, string> | null = null;
let aliasCacheAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadAliasMap(): Promise<Map<string, string>> {
  if (aliasCache && Date.now() - aliasCacheAt < CACHE_TTL_MS) return aliasCache;

  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(STATIC_ALIASES)) {
    map.set(k.toLowerCase(), v);
    map.set(k.toUpperCase(), v);
  }

  const rows = await db
    .select({ alias: salesPlatformAliases.alias, code: salesPlatformAliases.platformCode })
    .from(salesPlatformAliases);
  for (const row of rows) {
    map.set(row.alias.toLowerCase(), row.code);
    map.set(row.alias.toUpperCase(), row.code);
  }

  const platforms = await db
    .select({ code: salesPlatforms.code })
    .from(salesPlatforms)
    .where(eq(salesPlatforms.isActive, true));
  for (const p of platforms) {
    map.set(p.code.toLowerCase(), p.code);
    map.set(p.code, p.code);
  }

  aliasCache = map;
  aliasCacheAt = Date.now();
  return map;
}

export function clearSalesPlatformCache() {
  aliasCache = null;
}

function lookupStaticAlias(trimmed: string): string | null {
  const direct =
    STATIC_ALIASES[trimmed] ??
    STATIC_ALIASES[trimmed.toLowerCase()] ??
    STATIC_ALIASES[trimmed.toUpperCase()];
  if (direct) return direct;

  const normalized = trimmed.toUpperCase().replace(/\s+/g, '_');
  return STATIC_ALIASES[normalized] ?? null;
}

/** 导入热路径：仅用静态别名表归一化平台编码 */
export function normalizeSalesPlatformSync(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return 'UNKNOWN';

  const code = lookupStaticAlias(trimmed);
  return code ?? 'UNKNOWN';
}

/** 查询过滤：标准码 + 所有映射到该码的 alias（兼容历史中文 channel） */
export function channelsForPlatformFilterSync(code: string): string[] {
  const upper = code.trim().toUpperCase();
  const channels = new Set<string>([upper, code.trim()]);

  for (const [alias, target] of Object.entries(STATIC_ALIASES)) {
    if (target === upper) {
      channels.add(alias);
      channels.add(alias.toLowerCase());
      channels.add(alias.toUpperCase());
    }
  }

  return Array.from(channels);
}

export async function channelsForPlatformFilter(code: string): Promise<string[]> {
  const upper = code.trim().toUpperCase();
  const channels = new Set(channelsForPlatformFilterSync(upper));

  const map = await loadAliasMap();
  for (const [alias, target] of map.entries()) {
    if (target === upper) {
      channels.add(alias);
    }
  }

  return Array.from(channels);
}

/** 归一化平台编码；未知时返回 null */
export async function resolveSalesPlatformCode(raw?: string | null): Promise<string | null> {
  const trimmed = raw?.trim();
  if (!trimmed) return 'ALL';

  const staticCode = lookupStaticAlias(trimmed);
  if (staticCode) return staticCode;

  const map = await loadAliasMap();
  const direct = map.get(trimmed) ?? map.get(trimmed.toLowerCase()) ?? map.get(trimmed.toUpperCase());
  if (direct) return direct;

  const normalized = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (map.has(normalized)) return map.get(normalized)!;

  const [platform] = await db
    .select({ code: salesPlatforms.code })
    .from(salesPlatforms)
    .where(eq(salesPlatforms.code, normalized))
    .limit(1);
  return platform?.code ?? null;
}

export async function validateSalesPlatform(raw?: string | null): Promise<{
  code: string;
  warning?: string;
}> {
  const code = await resolveSalesPlatformCode(raw);
  if (!code) {
    return {
      code: 'UNKNOWN',
      warning: `未知在售平台: ${raw}`,
    };
  }
  return { code };
}

/** 统计导入计划中 UNKNOWN 渠道占比，超阈值返回告警文案 */
export function assessUnknownChannelShare(input: {
  totalRows: number;
  unknownRows: number;
  warnRatio?: number;
}): { ratio: number; warning?: string } {
  const total = Math.max(0, input.totalRows);
  const unknown = Math.max(0, input.unknownRows);
  const ratio = total > 0 ? unknown / total : 0;
  const threshold = input.warnRatio ?? SALES_IMPORT_UNKNOWN_CHANNEL_WARN_RATIO;
  if (total > 0 && ratio > threshold) {
    return {
      ratio,
      warning: `UNKNOWN 渠道占比 ${(ratio * 100).toFixed(1)}%（${unknown}/${total}）超过阈值 ${(threshold * 100).toFixed(0)}%，请补全 sales_platform_aliases 后回刷`,
    };
  }
  return { ratio };
}

export async function listActiveSalesPlatforms(station?: string) {
  const rows = await db
    .select()
    .from(salesPlatforms)
    .where(eq(salesPlatforms.isActive, true))
    .orderBy(salesPlatforms.sortOrder);

  if (!station) return rows;
  return rows.filter((r) => !r.station || r.station === station);
}
