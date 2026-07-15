/**
 * 外生冲击标记：广告/调价等导致销量异常，统计时从核心 KPI 剔除。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type ExogenousReason =
  | 'ad'
  | 'price_change'
  | 'promo'
  | 'listing_change'
  | 'other';

export type ExogenousSkuFlag = {
  skuCode: string;
  station?: string;
  platform?: string;
  reason: ExogenousReason;
  note?: string;
};

const DEFAULT_EXOGENOUS_FILE = resolve(
  import.meta.dirname,
  '../../../../docs/samples/forecast-backtest/exogenous-skus.csv',
);

export function mergeExogenousSkuSets(...sets: Iterable<string>[]): Set<string> {
  const out = new Set<string>();
  for (const set of sets) {
    for (const sku of set) out.add(sku);
  }
  return out;
}

/** 从 CSV 加载人工外生标记：sku,reason,note（可选 station/platform） */
export function loadExogenousFlagsFromCsv(path?: string): ExogenousSkuFlag[] {
  const file = path ?? process.env.FORECAST_EXOGENOUS_SKUS_CSV ?? DEFAULT_EXOGENOUS_FILE;
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length <= 1) return [];
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const out: ExogenousSkuFlag[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',').map((p) => p.trim());
    const sku = parts[idx('sku')] ?? parts[0] ?? '';
    if (!sku) continue;
    const reasonRaw = (parts[idx('reason')] ?? 'other').toLowerCase();
    const reason: ExogenousReason = [
      'ad',
      'price_change',
      'promo',
      'listing_change',
      'other',
    ].includes(reasonRaw as ExogenousReason)
      ? (reasonRaw as ExogenousReason)
      : 'other';
    out.push({
      skuCode: sku,
      station: parts[idx('station')] || undefined,
      platform: parts[idx('platform')] || undefined,
      reason,
      note: parts[idx('note')] || undefined,
    });
  }
  return out;
}

export function exogenousSkuCodesFromFlags(flags: ExogenousSkuFlag[]): Set<string> {
  return new Set(flags.map((f) => f.skuCode));
}

export function exogenousReasonLabel(reason: ExogenousReason): string {
  switch (reason) {
    case 'ad':
      return '广告投放';
    case 'price_change':
      return '调价';
    case 'promo':
      return '大促';
    case 'listing_change':
      return '链接/上架变更';
    default:
      return '其他外生冲击';
  }
}
