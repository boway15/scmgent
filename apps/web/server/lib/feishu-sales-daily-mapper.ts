import { extractFieldValue, type BitableRecord } from '../integrations/feishu-bitable.js';
import { classifyAnalyticsSiteFromReport } from './sales-analytics-dims.js';
import { normalizeStationFromReport, type DailySalesRow } from './sales-report-parser.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type FeishuSalesDailyMapping = {
  rows: DailySalesRow[];
  skipped: number;
  dates: string[];
};

/**
 * 最新付款日至少要到「今天往前 3 天」。
 * 任务在早上 5 点跑，飞书若尚未刷当天，表内最新日通常停在 T-3。
 */
export function assertFeishuSalesDailyWindow(dates: string[], today: string): void {
  const unique = [...new Set(dates.filter((date) => ISO_DATE.test(date)))].sort();
  if (!unique.length) {
    throw new Error('飞书销量长表没有付款日期，本次不同步。');
  }
  const newest = unique[unique.length - 1]!;
  const minNewest = shiftIsoDate(today, -3);
  if (newest < minNewest) {
    throw new Error(
      `飞书销量长表最新日期 ${newest} 早于 ${minNewest}，疑似未刷新，本次不同步。`,
    );
  }
}

export function mapFeishuSalesDailyRecords(records: BitableRecord[]): FeishuSalesDailyMapping {
  const rows: DailySalesRow[] = [];
  const dates = new Set<string>();
  let skipped = 0;

  for (const record of records) {
    const fields = record.fields ?? {};
    const skuCode = extractFieldValue(fields.Sku ?? fields.SKU);
    const saleDate = extractFieldValue(fields['付款日期(站点)']);
    const stationLabel = extractFieldValue(fields['站点']);
    const qty = parseQty(extractFieldValue(fields['销量']));
    if (!skuCode || !ISO_DATE.test(saleDate) || !stationLabel || qty == null) {
      skipped += 1;
      continue;
    }
    dates.add(saleDate);
    rows.push({
      skuCode,
      skuName: extractFieldValue(fields['SKU名称']),
      station: classifyFeishuSalesSite(stationLabel),
      platformRaw: platformRawFromStation(stationLabel),
      firstOrderAt: extractFieldValue(fields['首单时间']),
      category: extractFieldValue(fields['品类']),
      saleDate,
      qtySold: qty,
    });
  }

  return {
    rows,
    skipped,
    dates: [...dates].sort(),
  };
}

/** 与日宽表导入相同：先按报表站点归一，再归到 US / EU / UK / 其他。 */
export function classifyFeishuSalesSite(station: string): DailySalesRow['station'] {
  return classifyAnalyticsSiteFromReport(normalizeStationFromReport(station));
}

export function platformRawFromStation(station: string): string {
  const value = station.trim();
  const lower = value.toLowerCase();
  if (lower.startsWith('amazon') || value.includes('亚马逊')) return '亚马逊';
  if (lower.startsWith('wayfair')) return 'wayfair';
  if (lower.startsWith('tiktok') || lower.startsWith('tik tok')) return 'Tiktok';
  if (value.includes('沃尔玛') || lower.includes('walmart')) return '沃尔玛';
  if (lower.startsWith('shopify')) return 'Shopify';
  if (lower.startsWith('temu')) return 'TEMU';
  if (lower.startsWith('otto')) return 'OTTO';
  if (lower.startsWith('real')) return 'Real';
  if (lower.startsWith('manomano')) return 'manomano';
  if (value.toUpperCase().includes('B2B')) return 'B2B小包';
  return value;
}

function parseQty(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return null;
  return parsed;
}

function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
