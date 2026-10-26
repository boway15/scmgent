import {
  runReplenishmentForecast,
  type ReplenishmentDryRow,
} from '../tasks/replenishmentForecast.js';
import type { ActiveParamSet } from './core/resolve.js';
import { loadActiveParamSets } from './core/store.js';
import { replenishmentRule } from './replenishment/index.js';

export const SIMULATION_MAX_SKUS = 50;

type Snapshot = { suggestedQty: number; suggestedDate: string; healthStatus: string };

export type SimulationDiffRow = {
  skuCode: string;
  warehouseCode: string;
  before: Snapshot | null;
  after: Snapshot | null;
};

export function overlayDraft(active: ActiveParamSet[], draft: ActiveParamSet): ActiveParamSet[] {
  return [
    ...active.filter((s) => !(s.scopeType === draft.scopeType && s.scopeValue === draft.scopeValue)),
    draft,
  ];
}

function snap(row: ReplenishmentDryRow | undefined): Snapshot | null {
  return row
    ? { suggestedQty: row.suggestedQty, suggestedDate: row.suggestedDate, healthStatus: row.healthStatus }
    : null;
}

export function diffSuggestions(
  before: ReplenishmentDryRow[],
  after: ReplenishmentDryRow[],
): SimulationDiffRow[] {
  const key = (r: ReplenishmentDryRow) => `${r.skuCode}::${r.warehouseCode}`;
  const b = new Map(before.map((r) => [key(r), r]));
  const a = new Map(after.map((r) => [key(r), r]));
  const keys = [...new Set([...b.keys(), ...a.keys()])].sort();
  const out: SimulationDiffRow[] = [];
  for (const k of keys) {
    const x = snap(b.get(k));
    const y = snap(a.get(k));
    if (x && y && JSON.stringify(x) === JSON.stringify(y)) continue;
    const [skuCode, warehouseCode] = k.split('::');
    out.push({ skuCode, warehouseCode, before: x, after: y });
  }
  return out;
}

export async function simulateReplenishment(input: {
  draft: ActiveParamSet;
  skuIds: string[];
}): Promise<{ rows: SimulationDiffRow[]; changed: number; total: number }> {
  const skuIds = input.skuIds.slice(0, SIMULATION_MAX_SKUS);
  const active = await loadActiveParamSets(replenishmentRule.code);
  const [before, after] = await Promise.all([
    runReplenishmentForecast({ dryRun: true, skuIds, paramSets: active, trigger: 'simulation' }),
    runReplenishmentForecast({
      dryRun: true,
      skuIds,
      paramSets: overlayDraft(active, input.draft),
      trigger: 'simulation',
    }),
  ]);
  const beforeRows = before.dry?.suggestions ?? [];
  const afterRows = after.dry?.suggestions ?? [];
  const rows = diffSuggestions(beforeRows, afterRows);
  return { rows, changed: rows.length, total: new Set([...beforeRows, ...afterRows].map((r) => r.skuCode)).size };
}
