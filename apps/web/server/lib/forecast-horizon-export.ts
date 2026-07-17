/**
 * 预测 horizon 列表导出：宽表（未来矩阵）与明细表（明细视图）。
 * 字段与前端 ForecastHorizonPanel 列表列对齐。
 */
import { buildCsv } from './csv-export.js';
import { formatAllCatV41TierLabel, ALLCAT_V41_MODEL } from './forecast-allcat-v41.js';
import {
  listForecastHorizon,
  type ForecastHistoryCell,
  type ForecastHorizonCell,
  type ForecastHorizonRow,
} from './forecast-horizon.js';

export const FORECAST_HORIZON_EXPORT_MAX_SKUS = 20_000;
const PAGE_SIZE = 100;

export type ForecastHorizonExportMode = 'wide' | 'detail';

const LIFECYCLE_LABEL: Record<string, string> = {
  mature: '成熟',
  growth: '增长',
  decline: '下滑',
  new: '新品',
  intermittent: '间歇',
  stockout_suspected: '疑似断货',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

function formatLifecycle(value?: string | null): string {
  if (!value) return '';
  return LIFECYCLE_LABEL[value] ?? value;
}

function formatConfidence(value?: string | null): string {
  if (!value) return '';
  return CONFIDENCE_LABEL[value] ?? value;
}

function formatTierLabel(segment?: string | null): string {
  if (!segment?.trim()) return '';
  return formatAllCatV41TierLabel(segment);
}

function formatDaily(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return value.toFixed(2);
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return `${Math.round(value * 100)}%`;
}

function cellEffective(cell: Pick<ForecastHorizonCell, 'effectiveDailyAvg' | 'manualDailyAvg' | 'forecastDailyAvg'>): number {
  if (cell.effectiveDailyAvg != null && Number.isFinite(cell.effectiveDailyAvg)) {
    return cell.effectiveDailyAvg;
  }
  return cell.manualDailyAvg != null ? cell.manualDailyAvg : cell.forecastDailyAvg;
}

function isV41Cell(cell: ForecastHorizonCell): boolean {
  return cell.forecastModel === ALLCAT_V41_MODEL || cell.allCatV41Factors != null;
}

export function usesV41DetailColumns(items: ForecastHorizonRow[]): boolean {
  return items.some((row) => row.months.some((cell) => isV41Cell(cell)));
}

export type HorizonExportDataset = {
  horizon: Array<{ monthLabel: string }>;
  historyHorizon: Array<{ monthLabel: string }>;
  items: ForecastHorizonRow[];
};

/** 宽表：SKU / 渠道 / 生命周期 / 分层 + 各月生效日均 */
export function buildForecastHorizonWideCsv(dataset: HorizonExportDataset): {
  csv: string;
  rowCount: number;
} {
  const monthLabels = dataset.horizon.map((h) => h.monthLabel);
  const headers = ['SKU', 'SKU名称', '渠道', '生命周期', '分层', ...monthLabels];
  const rows = dataset.items.map((row) => {
    const byLabel = new Map(row.months.map((cell) => [cell.monthLabel, cell]));
    return [
      row.skuCode,
      row.skuName,
      row.platform,
      formatLifecycle(row.lifecycle),
      formatTierLabel(row.profileSegment),
      ...monthLabels.map((label) => {
        const cell = byLabel.get(label);
        return cell ? formatDaily(cellEffective(cell)) : '';
      }),
    ];
  });
  return { csv: buildCsv(headers, rows), rowCount: rows.length };
}

/** 明细表：历史 + 未来逐月行，列与明细视图一致 */
export function buildForecastHorizonDetailCsv(dataset: HorizonExportDataset): {
  csv: string;
  rowCount: number;
} {
  const useV41 = usesV41DetailColumns(dataset.items);
  const factorHeaders = useV41
    ? ['T层', 'd6', '趋势比', '季节朴素']
    : ['w近', '近端', '结构', '增长', '季节系数', '趋势系数', '品类综合'];

  const headers = [
    '时段',
    'SKU',
    '品类',
    '渠道',
    '绝对月',
    '生命周期',
    '置信度',
    '基线日均',
    ...factorHeaders,
    '生效日均',
    '系统预测',
    '校准值',
  ];

  const rows: Array<Array<string | number | null | undefined>> = [];

  for (const row of dataset.items) {
    for (const cell of row.historyMonths ?? []) {
      rows.push(buildHistoryDetailRow(row, cell, factorHeaders.length));
    }
    for (const cell of row.months) {
      rows.push(buildFutureDetailRow(row, cell, useV41));
    }
  }

  return { csv: buildCsv(headers, rows), rowCount: rows.length };
}

function buildHistoryDetailRow(
  row: ForecastHorizonRow,
  cell: ForecastHistoryCell,
  factorColCount: number,
): Array<string | number | null | undefined> {
  const pads = Array.from({ length: factorColCount + 2 }, () => '');
  return [
    '历史',
    row.skuCode,
    row.category ?? '',
    row.platform,
    cell.monthLabel,
    formatLifecycle(row.lifecycle),
    ...pads,
    formatDaily(cell.actualDailyAvg),
    '',
    '',
  ];
}

function buildFutureDetailRow(
  row: ForecastHorizonRow,
  cell: ForecastHorizonCell,
  useV41: boolean,
): Array<string | number | null | undefined> {
  const factorCols = useV41
    ? [
        cell.allCatV41Factors?.tier ?? '',
        formatDaily(cell.allCatV41Factors?.d6),
        formatDaily(cell.allCatV41Factors?.trendRatio),
        formatDaily(cell.allCatV41Factors?.seasonalDaily),
      ]
    : [
        cell.horizonFactors ? formatPct(cell.horizonFactors.wNear) : '',
        formatDaily(cell.horizonFactors?.nearLevel),
        formatDaily(cell.horizonFactors?.structuralLevel),
        formatDaily(cell.horizonFactors?.growthFactor),
        formatDaily(cell.seasonalityFactor),
        formatDaily(cell.trendFactor),
        formatDaily(cell.categoryCombinedFactor),
      ];

  return [
    '未来',
    row.skuCode,
    row.category ?? '',
    row.platform,
    cell.monthLabel,
    formatLifecycle(cell.lifecycle ?? row.lifecycle),
    formatConfidence(cell.confidenceLevel),
    formatDaily(cell.baselineDailyAvg),
    ...factorCols,
    formatDaily(cellEffective(cell)),
    formatDaily(cell.forecastDailyAvg),
    cell.manualDailyAvg != null ? formatDaily(cell.manualDailyAvg) : '',
  ];
}

export async function loadForecastHorizonExportDataset(input: {
  versionId: string;
  station?: string;
  platform?: string;
  skuCode?: string;
  category?: string;
  profileSegment?: string;
  pendingCalibration?: boolean;
  monthCount?: number;
  historyMonthCount?: number;
  maxSkus?: number;
}): Promise<HorizonExportDataset> {
  const maxSkus = Math.min(
    Math.max(1, input.maxSkus ?? FORECAST_HORIZON_EXPORT_MAX_SKUS),
    FORECAST_HORIZON_EXPORT_MAX_SKUS,
  );
  const items: ForecastHorizonRow[] = [];
  let horizon: HorizonExportDataset['horizon'] = [];
  let historyHorizon: HorizonExportDataset['historyHorizon'] = [];
  let page = 1;
  let total = Infinity;

  while (items.length < maxSkus && items.length < total) {
    const result = await listForecastHorizon({
      versionId: input.versionId,
      station: input.station,
      platform: input.platform,
      skuCode: input.skuCode,
      category: input.category,
      profileSegment: input.profileSegment,
      pendingCalibration: input.pendingCalibration,
      page,
      pageSize: PAGE_SIZE,
      monthCount: input.monthCount,
      historyMonthCount: input.historyMonthCount,
    });
    total = result.total;
    if (page === 1) {
      horizon = result.horizon;
      historyHorizon = result.historyHorizon;
    }
    if (!result.items.length) break;
    const remaining = maxSkus - items.length;
    items.push(...result.items.slice(0, remaining));
    if (result.items.length < PAGE_SIZE) break;
    page += 1;
  }

  return { horizon, historyHorizon, items };
}

export async function buildForecastHorizonExportCsv(input: {
  mode: ForecastHorizonExportMode;
  versionId: string;
  station?: string;
  platform?: string;
  skuCode?: string;
  category?: string;
  profileSegment?: string;
  pendingCalibration?: boolean;
  monthCount?: number;
  historyMonthCount?: number;
}): Promise<{ csv: string; rowCount: number; skuCount: number }> {
  const historyMonthCount =
    input.mode === 'wide' ? 0 : (input.historyMonthCount ?? input.monthCount ?? 6);
  const monthCount = input.monthCount ?? 6;

  const dataset = await loadForecastHorizonExportDataset({
    ...input,
    monthCount,
    historyMonthCount,
  });

  const built =
    input.mode === 'wide'
      ? buildForecastHorizonWideCsv(dataset)
      : buildForecastHorizonDetailCsv(dataset);

  return {
    csv: built.csv,
    rowCount: built.rowCount,
    skuCount: dataset.items.length,
  };
}
