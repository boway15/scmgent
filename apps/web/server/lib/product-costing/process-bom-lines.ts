import { canonicalMaterialName } from './category-rules.js';
import type { ProcessOverrides } from './board-sheet.js';
import { parseBoardSpec } from './parse-board-spec.js';
import type { CostingBomLineDraft } from './types.js';

const CANONICAL_BOARD_PART =
  /^(抽面|抽侧|抽后|抽底|侧板|顶底板|背板|前拉条|背拉条|落地拉条|踢脚线|桌面板|桌面|台面)$/;

export type DrawerProcessHint = 'drawer_bottom_slot' | 'drawer_front_bevel';

function appendNote(notes: string, extra: string): string {
  if (!extra) return notes;
  if (!notes) return extra;
  if (notes.includes(extra)) return notes;
  return `${notes}；${extra}`;
}

function parseCutSizePair(spec: string): { a: number; b: number } | null {
  const match = parseBoardSpec(spec).size.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!(a > 0) || !(b > 0)) return null;
  return { a, b: b };
}

function sameCutSize(left: CostingBomLineDraft, right: CostingBomLineDraft): boolean {
  const a = parseCutSizePair(left.spec);
  const b = parseCutSizePair(right.spec);
  if (!a || !b) return false;
  return (
    Math.abs(Math.max(a.a, a.b) - Math.max(b.a, b.b)) <= 2 &&
    Math.abs(Math.min(a.a, a.b) - Math.min(b.a, b.b)) <= 2
  );
}

/** notes 页把「抽屉底板开槽」等工艺误输出为板材行。 */
export function isGrooveProcessMisname(name: string): boolean {
  const canonical = canonicalMaterialName(name.trim());
  if (CANONICAL_BOARD_PART.test(canonical)) return false;
  return /开槽|拉槽|铣槽/.test(name.trim());
}

/** notes 页把「抽面上沿斜切」等工艺误输出为板材行。 */
export function isBevelProcessMisname(name: string): boolean {
  const canonical = canonicalMaterialName(name.trim());
  if (canonical === '抽面') return false;
  const text = name.trim();
  if (/斜切|倒角|铣型/.test(text) && /抽面|面板|抽/.test(text)) return true;
  return /^(抽面)?上沿/.test(text) && /斜切|倒角/.test(text);
}

export function drawerProcessHintFromLine(
  line: Pick<CostingBomLineDraft, 'materialName' | 'notes' | 'spec'>,
): DrawerProcessHint | null {
  const text = `${line.materialName} ${line.notes} ${line.spec}`;
  if (isGrooveProcessMisname(line.materialName) || /底板.*(开槽|拉槽|插入)|开槽.*底板|拉槽.*底板/.test(text)) {
    return 'drawer_bottom_slot';
  }
  if (
    isBevelProcessMisname(line.materialName) ||
    /45°|45度/.test(text) ||
    (/斜切|倒角/.test(text) && /抽面|面板|拉手/.test(text))
  ) {
    return 'drawer_front_bevel';
  }
  return null;
}

export function drawerProcessHintsFromText(text: string): DrawerProcessHint[] {
  const hints = new Set<DrawerProcessHint>();
  if (/开槽|拉槽|底板.*插入|插入.*底板/.test(text)) hints.add('drawer_bottom_slot');
  if (/斜切|45°|45度|倒角.*拉手|拉手.*倒角/.test(text)) hints.add('drawer_front_bevel');
  return [...hints];
}

function normalizeBoardUnit(line: CostingBomLineDraft): CostingBomLineDraft {
  if (line.unit.trim() === '项' && line.category === '板材') {
    return { ...line, unit: '块', notes: appendNote(line.notes, '板件单位已由项改为块') };
  }
  return line;
}

function mergeFrontFromBevel(existing: CostingBomLineDraft, proc: CostingBomLineDraft): CostingBomLineDraft {
  const procOverrides = proc.processOverrides ? { ...proc.processOverrides } : undefined;
  if (procOverrides) delete procOverrides.grooveMeters;
  return normalizeBoardUnit({
    ...existing,
    materialName: '抽面',
    spec: mergeBoardSpec(existing.spec, proc.spec),
    qtyNet: Math.max(existing.qtyNet, proc.qtyNet),
    origin: existing.origin === 'explicit' || proc.origin === 'explicit' ? 'explicit' : existing.origin,
    sourceRef: [...new Set([existing.sourceRef, proc.sourceRef].filter(Boolean))].join(','),
    notes: appendNote(existing.notes, appendNote(proc.notes, '含上沿斜切拉手工艺')),
    processOverrides: mergeProcessOverrides(existing.processOverrides, procOverrides),
  });
}

function mergeBoardSpec(primary: string, secondary: string): string {
  const left = parseBoardSpec(primary);
  const right = parseBoardSpec(secondary);
  const thickness = left.thickness || right.thickness;
  const size = left.size || right.size;
  return [thickness, size].filter(Boolean).join(' ').trim() || primary.trim() || secondary.trim();
}

export function mergeProcessOverrides(
  left?: ProcessOverrides,
  right?: ProcessOverrides,
): ProcessOverrides | undefined {
  if (!left && !right) return undefined;
  return { ...right, ...left };
}

/** notes 页把抽屉厚度标准误输出为板材行。 */
export function isDrawerThicknessStandardLine(
  line: Pick<CostingBomLineDraft, 'materialName' | 'spec' | 'qtyNet'>,
): boolean {
  if (line.qtyNet > 0) return false;
  if (parseBoardSpec(line.spec).size) return false;
  const text = `${line.materialName} ${line.spec}`;
  return /厚度标准|用\s*\d+\s*mm\s*板/.test(text) && /抽屉|抽底/.test(text);
}

/**
 * P0：把 Dify 误识别的工艺说明行合并到抽面/抽底，或丢弃重复开槽行。
 */
export function absorbProcessMisnamedBoardRows(lines: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const processRows: CostingBomLineDraft[] = [];
  const kept: CostingBomLineDraft[] = [];

  for (const line of lines) {
    const hint = drawerProcessHintFromLine(line);
    const sized = Boolean(parseCutSizePair(line.spec));
    if (hint && (sized || hint === 'drawer_front_bevel' || hint === 'drawer_bottom_slot')) {
      processRows.push(line);
      continue;
    }
    kept.push(line);
  }

  let result = [...kept];
  for (const proc of processRows) {
    const hint = drawerProcessHintFromLine(proc)!;
    if (hint === 'drawer_front_bevel') {
      const index = result.findIndex((line) => canonicalMaterialName(line.materialName) === '抽面');
      if (index >= 0) {
        result[index] = mergeFrontFromBevel(result[index]!, proc);
      } else if (canonicalMaterialName(proc.materialName) === '抽面' && !parseCutSizePair(proc.spec)) {
        result.push(
          normalizeBoardUnit({
            ...proc,
            materialName: '抽面',
            category: '板材',
            spec: '',
            notes: appendNote(appendNote(proc.notes, proc.spec.trim()), '含上沿斜切拉手工艺'),
          }),
        );
      } else {
        result.push(
          normalizeBoardUnit({
            ...proc,
            materialName: '抽面',
            category: '板材',
            notes: appendNote(proc.notes, '自斜切/倒角说明行合并为抽面'),
          }),
        );
      }
      continue;
    }

    const bottomIndex = result.findIndex((line) => canonicalMaterialName(line.materialName) === '抽底');
    if (bottomIndex >= 0 && sameCutSize(result[bottomIndex]!, proc)) {
      result[bottomIndex] = {
        ...result[bottomIndex]!,
        notes: appendNote(result[bottomIndex]!.notes, appendNote(proc.notes, '含抽屉底板开槽工艺')),
        processOverrides: mergeProcessOverrides(result[bottomIndex]!.processOverrides, proc.processOverrides),
      };
      continue;
    }
    if (bottomIndex < 0 && parseCutSizePair(proc.spec)) {
      result.push(
        normalizeBoardUnit({
          ...proc,
          materialName: '抽底',
          category: '板材',
          notes: appendNote(proc.notes, '自开槽说明行转为抽底'),
        }),
      );
      continue;
    }
    if (bottomIndex >= 0) {
      result[bottomIndex] = {
        ...result[bottomIndex]!,
        notes: appendNote(result[bottomIndex]!.notes, appendNote(proc.notes, '含抽屉底板开槽工艺')),
      };
    }
  }

  return result;
}

export { parseCutSizePair };
