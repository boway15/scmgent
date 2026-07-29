export type ReorderSuggestionExplainItem = {
  reason: string;
  healthStatus?: string | null;
  coverageDays?: string | null;
  suggestedQty: number;
  suggestedDate: string;
  totalLeadDays?: number | null;
  latestOrderDays?: string | null;
};

type InventoryPositionMetrics = {
  effectiveQty?: number;
  qtyAvailable?: number;
  qtyInProduction?: number;
  qtyInTransit?: number;
  qtyConfirmedOpen?: number;
  qtyReserved?: number;
};

const HEALTH_TRIGGER: Record<string, string> = {
  red: '覆盖低于总提前期，需补货',
  yellow: '进入补货计划窗口',
  green: '覆盖处于安全区间（本条为历史或手动建议）',
  blue: '库存偏多，通常不产生补货建议',
  gray: '滞销或停售，暂停自动补货',
};

const DEMAND_SOURCE_LABEL: Record<string, string> = {
  forecast: '销售预测',
  historical: '历史销量',
};

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fmtDays(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function deriveTriggerReason(item: ReorderSuggestionExplainItem): string {
  const trimmed = item.reason?.trim();
  if (trimmed) return trimmed;

  const health = item.healthStatus?.trim().toLowerCase();
  if (health && HEALTH_TRIGGER[health]) {
    const coverage = num(item.coverageDays);
    const coveragePart =
      coverage != null ? `，当前覆盖 ${fmtDays(coverage)} 天` : '';
    return `${HEALTH_TRIGGER[health]}${coveragePart}`;
  }

  const coverage = num(item.coverageDays);
  if (coverage != null) {
    return `覆盖 ${fmtDays(coverage)} 天，低于目标需补货`;
  }

  return '系统判定需补货';
}

function readInventoryPosition(metrics: Record<string, unknown>): InventoryPositionMetrics | null {
  const raw = metrics.inventoryPosition;
  if (!raw || typeof raw !== 'object') return null;
  const pos = raw as InventoryPositionMetrics;
  if (num(pos.effectiveQty) == null) return null;
  return pos;
}

function deriveAvgDaily(
  metrics: Record<string, unknown>,
  item: ReorderSuggestionExplainItem,
  effectiveQty: number,
): number | null {
  const fromMetrics = num(metrics.avgDaily);
  if (fromMetrics != null && fromMetrics > 0) return fromMetrics;

  const coverage = num(item.coverageDays);
  if (coverage != null && coverage > 0 && Number.isFinite(coverage)) {
    return effectiveQty / coverage;
  }
  return null;
}

export function formatSuggestionExplain(
  metrics: Record<string, unknown> | null | undefined,
  item: ReorderSuggestionExplainItem,
): string {
  if (!metrics) return item.reason?.trim() || deriveTriggerReason(item);

  const position = readInventoryPosition(metrics);
  const totalLeadDays = num(metrics.totalLeadDays) ?? num(item.totalLeadDays);
  const productionDays = num(metrics.productionDays);
  const domesticDays = num(metrics.domesticDays);
  const bookingDays = num(metrics.bookingDays);
  const transitDays = num(metrics.transitDays);
  const customsDays = num(metrics.customsDays);
  const inboundDays = num(metrics.inboundDays);

  const hasLeadSegments =
    productionDays != null &&
    domesticDays != null &&
    bookingDays != null &&
    transitDays != null &&
    customsDays != null &&
    inboundDays != null &&
    totalLeadDays != null;

  if (!position || !hasLeadSegments) {
    return item.reason?.trim() || deriveTriggerReason(item);
  }

  const effectiveQty = position.effectiveQty!;
  const avgDaily = deriveAvgDaily(metrics, item, effectiveQty);
  const demandSource = String(metrics.demandSource ?? 'historical');
  let demandLabel = DEMAND_SOURCE_LABEL[demandSource] ?? demandSource;
  if (demandSource === 'historical' && metrics.stockoutAdjusted === true) {
    const inStockDays = num(metrics.inStockDays);
    const demandWindowDays = num(metrics.demandWindowDays);
    demandLabel =
      inStockDays != null && demandWindowDays != null
        ? `断货修正历史，${fmtDays(inStockDays)}/${fmtDays(demandWindowDays)} 天有货`
        : '断货修正历史';
  }

  const lines = [
    `触发原因：${deriveTriggerReason(item)}`,
    `库存位置：${fmtQty(effectiveQty)} = 可售 ${fmtQty(position.qtyAvailable ?? 0)} + 生产 ${fmtQty(position.qtyInProduction ?? 0)} + 在途 ${fmtQty(position.qtyInTransit ?? 0)} + 已确认未生产 ${fmtQty(position.qtyConfirmedOpen ?? 0)} − 已分配 ${fmtQty(position.qtyReserved ?? 0)}`,
  ];

  if (avgDaily != null) {
    lines.push(`日均需求：${fmtQty(avgDaily)}（${demandLabel}）`);
  } else {
    lines.push(`日均需求：—（${demandLabel}）`);
  }

  lines.push(
    `总提前期：${totalLeadDays} = 生产 ${productionDays} + 国内 ${domesticDays} + 订舱 ${bookingDays} + 海运 ${transitDays} + 清关 ${customsDays} + 入仓 ${inboundDays}`,
  );

  const safetyStockDays = num(metrics.safetyStockDays);
  const targetCoverageDays = num(metrics.targetCoverageDays);
  const profileId = metrics.leadTimeProfileId;

  const detailParts: string[] = [];
  if (safetyStockDays != null) detailParts.push(`安全库存天数 ${fmtDays(safetyStockDays)}`);
  if (targetCoverageDays != null) detailParts.push(`目标覆盖 ${fmtDays(targetCoverageDays)} 天`);
  detailParts.push(`建议量 ${fmtQty(item.suggestedQty)}`);
  detailParts.push(`建议下单日 ${item.suggestedDate}`);
  if (profileId != null && String(profileId).trim()) {
    detailParts.push(`提前期档案 ${String(profileId)}`);
  } else {
    detailParts.push('提前期档案 —');
  }
  lines.push(detailParts.join(' · '));

  return lines.join('\n');
}
