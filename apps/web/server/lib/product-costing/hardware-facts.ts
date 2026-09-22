import { canonicalMaterialName, isChestCategory } from './category-rules.js';
import type { CostingBomLineDraft } from './types.js';

export const HARDWARE_FACT_NAMES = ['抽屉滑轨', '防倾倒配件'] as const;
export type HardwareFactName = (typeof HARDWARE_FACT_NAMES)[number];
export type HardwareFact = { name: HardwareFactName; spec: string; qty: number };

const ALLOWED = new Set<string>(HARDWARE_FACT_NAMES);
const MANUAL_NOTE = '人工补全';
const SCREW_PACK_NOTE = '默认一件螺丝包';
export const DRAWER_SLIDE_NOTE = '一抽一套滑轨';
export const SLIDE_SPEC_FROM_DESIGN_NOTE = '规格来自设计说明';
export const ANTI_TIP_FROM_DOC_NOTE = '文档明示防倾倒';
export const SCREW_PACK_NAME = '螺丝包';

export function isScrewPack(name: string): boolean {
  return canonicalMaterialName(name) === SCREW_PACK_NAME || /螺丝包/.test(name);
}

function isDrawerSlideLine(name: string): boolean {
  const canonical = canonicalMaterialName(name);
  return canonical === '抽屉滑轨' || /滑轨/.test(canonical);
}

export function isBundledOtherHardware(name: string): boolean {
  if (isScrewPack(name)) return false;
  const canonical = canonicalMaterialName(name);
  return /拉手|把手|螺丝|螺钉|三合一/.test(canonical);
}

function isFactName(name: string): name is HardwareFactName {
  return ALLOWED.has(name);
}

function appendNote(notes: string, extra: string): string {
  if (!extra) return notes;
  if (notes.includes(extra)) return notes;
  return notes ? `${notes}；${extra}` : extra;
}

export function parseHardwareFacts(raw: unknown): HardwareFact[] {
  if (!Array.isArray(raw)) return [];
  const byName = new Map<HardwareFactName, HardwareFact>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const canonical = canonicalMaterialName(String(record.name ?? ''));
    if (!isFactName(canonical)) continue;
    const qty = Number(record.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    byName.set(canonical, {
      name: canonical,
      spec: String(record.spec ?? '').trim(),
      qty,
    });
  }
  return HARDWARE_FACT_NAMES.map((name) => byName.get(name)).filter(
    (item): item is HardwareFact => Boolean(item),
  );
}

export function upsertHardwareFacts(
  lines: CostingBomLineDraft[],
  facts: HardwareFact[],
): CostingBomLineDraft[] {
  let result = [...lines];
  for (const fact of facts) {
    const index = result.findIndex(
      (line) => canonicalMaterialName(line.materialName) === fact.name,
    );
    if (index < 0) {
      result.push({
        category: '五金',
        materialName: fact.name,
        spec: fact.spec,
        unit: '套',
        qtyNet: fact.qty,
        lossRate: 0,
        sourceRef: '',
        confidence: 'high',
        origin: 'explicit',
        notes: MANUAL_NOTE,
      });
      continue;
    }
    const current = result[index]!;
    result[index] = {
      ...current,
      materialName: fact.name,
      spec: fact.spec || current.spec,
      qtyNet: fact.qty,
      category: current.category || '五金',
      unit: current.unit || '套',
      notes: appendNote(current.notes, MANUAL_NOTE),
    };
  }
  return result;
}

/** 斗柜/床头柜：有抽屉数时补全或对齐滑轨数量（一抽一套）。规格保留识别/手填结果。 */
export function ensureDrawerSlides(
  lines: CostingBomLineDraft[],
  input: {
    drawerCount?: number | null;
    category?: string | null;
    slideSpecHint?: string | null;
  },
): CostingBomLineDraft[] {
  const drawers =
    typeof input.drawerCount === 'number' && input.drawerCount > 0 ? input.drawerCount : 0;
  if (!drawers || !isChestCategory(input.category)) return lines;

  const specHint = input.slideSpecHint?.trim() ?? '';
  const index = lines.findIndex((line) => isDrawerSlideLine(line.materialName));
  if (index < 0) {
    return [
      ...lines,
      {
        category: '五金',
        materialName: '抽屉滑轨',
        spec: specHint,
        unit: '套',
        qtyNet: drawers,
        lossRate: 0,
        sourceRef: '',
        confidence: 'high',
        origin: 'template',
        notes: [DRAWER_SLIDE_NOTE, specHint ? SLIDE_SPEC_FROM_DESIGN_NOTE : '']
          .filter(Boolean)
          .join('；'),
      },
    ];
  }

  const current = lines[index]!;
  const resolvedSpec = current.spec?.trim() || specHint;
  const result = [...lines];
  result[index] = {
    ...current,
    materialName: '抽屉滑轨',
    category: current.category || '五金',
    unit: current.unit || '套',
    spec: resolvedSpec,
    qtyNet: drawers,
    notes: appendNote(
      appendNote(current.notes, DRAWER_SLIDE_NOTE),
      !current.spec?.trim() && specHint ? SLIDE_SPEC_FROM_DESIGN_NOTE : '',
    ),
  };
  return result;
}

function isAntiTipLine(name: string): boolean {
  const canonical = canonicalMaterialName(name);
  return canonical === '防倾倒配件' || /防倾倒/.test(canonical);
}

/** 文档出现防倾倒时补一行（通常 1 套），不臆造未标注的斗柜。 */
export function ensureAntiTipKit(
  lines: CostingBomLineDraft[],
  input: { category?: string | null; seenInDoc?: boolean },
): CostingBomLineDraft[] {
  if (!input.seenInDoc || !isChestCategory(input.category)) return lines;

  const index = lines.findIndex((line) => isAntiTipLine(line.materialName));
  if (index < 0) {
    return [
      ...lines,
      {
        category: '五金',
        materialName: '防倾倒配件',
        spec: '',
        unit: '套',
        qtyNet: 1,
        lossRate: 0,
        sourceRef: '',
        confidence: 'high',
        origin: 'template',
        notes: ANTI_TIP_FROM_DOC_NOTE,
      },
    ];
  }

  const current = lines[index]!;
  const result = [...lines];
  result[index] = {
    ...current,
    materialName: '防倾倒配件',
    category: '五金',
    unit: current.unit || '套',
    qtyNet: current.qtyNet > 0 ? current.qtyNet : 1,
    notes: appendNote(current.notes, ANTI_TIP_FROM_DOC_NOTE),
  };
  return result;
}

export function ensureScrewPack(lines: CostingBomLineDraft[]): CostingBomLineDraft[] {
  const packs = lines.filter((line) => isScrewPack(line.materialName));
  const rest = lines.filter((line) => !isScrewPack(line.materialName));
  const fromDoc = packs.find((line) => line.origin === 'explicit') ?? packs[0];
  const sourceRefs = [
    ...new Set(
      packs.flatMap((line) => line.sourceRef.split(/[,，]/)).map((part) => part.trim()).filter(Boolean),
    ),
  ].join(',');
  const pack: CostingBomLineDraft = {
    category: '五金',
    materialName: SCREW_PACK_NAME,
    spec: fromDoc?.spec?.trim() ?? '',
    unit: '包',
    qtyNet: 1,
    lossRate: 0,
    sourceRef: sourceRefs,
    confidence: 'high',
    origin: packs.some((line) => line.origin === 'explicit') ? 'explicit' : 'template',
    notes: packs.reduce((notes, line) => appendNote(notes, line.notes), SCREW_PACK_NOTE),
  };
  return [...rest, pack];
}
