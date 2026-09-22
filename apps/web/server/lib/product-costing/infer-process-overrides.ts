import type { ProcessOverrides } from './board-sheet.js';
import { perimeterMeters } from './board-sheet.js';
import {
  drawerProcessHintsFromText,
  parseCutSizePair,
} from './process-bom-lines.js';
import { parseBoardSpec } from './parse-board-spec.js';
import type { CostingBomLineDraft } from './types.js';

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseSizeMm(spec: string): { lengthMm: number; widthMm: number } | null {
  const pair = parseCutSizePair(spec);
  if (!pair) return null;
  return { lengthMm: Math.max(pair.a, pair.b), widthMm: Math.min(pair.a, pair.b) };
}

/** 抽底插入槽长度：取抽底较短边。 */
export function drawerBottomGrooveMetersPerPiece(drawerBottomSpec: string): number {
  const pair = parseCutSizePair(drawerBottomSpec);
  if (!pair) return 0;
  return money(Math.min(pair.a, pair.b) / 1000);
}

/** 抽面上沿 45° 斜切：在周长外每块加约 0.45×抽面宽度的开料米数。 */
export function drawerFrontBevelExtraCutMeters(frontSpec: string, qty: number): number {
  const size = parseSizeMm(frontSpec);
  if (!size || !(qty > 0)) return 0;
  return money((size.widthMm / 1000) * 0.45 * qty);
}

function mergeOverrides(
  existing: ProcessOverrides | undefined,
  patch: ProcessOverrides,
): ProcessOverrides {
  const next = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch) as Array<[keyof ProcessOverrides, number | null | undefined]>) {
    if (value === undefined) continue;
    if (next[key] === undefined || next[key] === null) {
      next[key] = value;
    }
  }
  return next;
}

/** P2：从已确认原则与清单 notes 推断开槽/斜切工艺量，写入 processOverrides。 */
export function applyInferredProcessOverrides(
  lines: CostingBomLineDraft[],
  facts: { designPrinciples?: string | null; structureSummary?: string | null },
): CostingBomLineDraft[] {
  const corpus = [
    facts.designPrinciples,
    facts.structureSummary,
    ...lines.map((line) => `${line.materialName} ${line.notes}`),
  ]
    .filter(Boolean)
    .join(' ');
  const hints = drawerProcessHintsFromText(corpus);
  const hasBottomSlot = hints.includes('drawer_bottom_slot');
  const hasFrontBevel = hints.includes('drawer_front_bevel');

  const bottom = lines.find((line) => line.materialName.trim() === '抽底' && parseCutSizePair(line.spec));
  const groovePerPiece = bottom ? drawerBottomGrooveMetersPerPiece(bottom.spec) : 0;

  return lines.map((line) => {
    let overrides = line.processOverrides;

    if (hasBottomSlot && groovePerPiece > 0 && line.qtyNet > 0) {
      if (/^抽侧$/.test(line.materialName.trim()) || /^抽后$/.test(line.materialName.trim())) {
        overrides = mergeOverrides(overrides, {
          grooveMeters: money(groovePerPiece * line.qtyNet),
        });
      }
    }

    if (hasFrontBevel && line.materialName.trim() === '抽面' && line.qtyNet > 0 && parseBoardSpec(line.spec).size) {
      const size = parseSizeMm(line.spec);
      if (size) {
        const basePerimeter = perimeterMeters(size.lengthMm, size.widthMm, line.qtyNet);
        const bevelExtra = drawerFrontBevelExtraCutMeters(line.spec, line.qtyNet);
        overrides = mergeOverrides(overrides, {
          cutMeters: money(basePerimeter + bevelExtra),
        });
      }
    }

    if (line.materialName.trim() === '抽面' && overrides?.grooveMeters !== undefined) {
      const { grooveMeters: _drop, ...rest } = overrides;
      overrides = Object.keys(rest).length ? rest : undefined;
    }

    if (!overrides || Object.keys(overrides).length === 0) return line;
    return { ...line, processOverrides: overrides };
  });
}
