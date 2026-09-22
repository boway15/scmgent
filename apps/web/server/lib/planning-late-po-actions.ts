/**
 * uncoverableByNewPo 只读动作排序：他仓可售、快船、接受断货天数。
 * 不自动执行。
 */

import { addDaysIso, diffDaysIso } from './inventory-iso-date.js';

export type LatePoAction = {
  kind: 'transfer' | 'fast_ship' | 'accept_stockout';
  label: string;
  detail: string;
  qty?: number;
  days?: number;
};

export type PeerWarehouseSupply = {
  warehouseCode: string;
  regionGroup: string;
  confirmedAvailableQty: number;
};

/**
 * 近窗缺口（确定缺货日前累计需求近似）：avgDaily × daysUntilStockout（至少 1）。
 */
export function estimateNearWindowGap(params: {
  avgDaily: number;
  today: string;
  stockoutDateConfirmed: string | null;
}): number {
  if (params.avgDaily <= 0 || !params.stockoutDateConfirmed) return 0;
  const days = Math.max(1, diffDaysIso(params.today, params.stockoutDateConfirmed));
  return Math.ceil(params.avgDaily * days);
}

export function buildLatePoActions(params: {
  today: string;
  warehouseCode: string;
  regionGroup: string;
  uncoverableByNewPo: boolean;
  stockoutDateConfirmed: string | null;
  avgDaily: number;
  totalLeadDays: number;
  /** 同区域他仓确定可售 */
  peerWarehouses?: PeerWarehouseSupply[];
  /** 快船总提前期（天）；缺省用海运的 60% */
  fastShipLeadDays?: number;
}): LatePoAction[] {
  if (!params.uncoverableByNewPo) return [];

  const actions: LatePoAction[] = [];
  const gap = estimateNearWindowGap({
    avgDaily: params.avgDaily,
    today: params.today,
    stockoutDateConfirmed: params.stockoutDateConfirmed,
  });

  const peers = (params.peerWarehouses ?? []).filter(
    (p) =>
      p.warehouseCode !== params.warehouseCode &&
      p.regionGroup === params.regionGroup &&
      p.confirmedAvailableQty > 0,
  );
  const peerCover = peers.reduce((s, p) => s + p.confirmedAvailableQty, 0);
  if (peers.length > 0) {
    const top = [...peers].sort((a, b) => b.confirmedAvailableQty - a.confirmedAvailableQty)[0]!;
    const covers = gap <= 0 || peerCover >= gap;
    actions.push({
      kind: 'transfer',
      label: covers ? '同区他仓可覆盖近窗缺口' : '同区他仓可部分覆盖',
      detail: `${top.warehouseCode} 等 ${peers.length} 仓合计确定可售 ${peerCover}${
        gap > 0 ? `，近窗缺口约 ${gap}` : ''
      }`,
      qty: peerCover,
    });
  }

  const fastLead = Math.max(
    1,
    Math.round(params.fastShipLeadDays ?? params.totalLeadDays * 0.6),
  );
  const seaReady = addDaysIso(params.today, Math.ceil(params.totalLeadDays));
  const fastReady = addDaysIso(params.today, fastLead);
  const stockout = params.stockoutDateConfirmed;
  if (stockout && fastReady < seaReady) {
    const stillLate = stockout < fastReady;
    actions.push({
      kind: 'fast_ship',
      label: stillLate ? '快船仍可能赶不上' : '快船可能赶上缺货日',
      detail: `快船约 ${fastLead} 天可售（${fastReady}），海运约 ${params.totalLeadDays} 天（${seaReady}）`,
      days: fastLead,
    });
  }

  if (stockout) {
    const stockoutDays = Math.max(0, diffDaysIso(stockout, seaReady));
    actions.push({
      kind: 'accept_stockout',
      label: '接受断货至新海运可售',
      detail: `确定缺货日 ${stockout} 至海运可售日 ${seaReady}，约 ${stockoutDays} 天`,
      days: stockoutDays,
    });
  }

  return actions;
}
