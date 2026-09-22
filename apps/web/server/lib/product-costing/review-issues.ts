import type { ComputeBlocker } from './compute-gate.js';
import { isRolledProcessLine } from './board-sheet.js';
import { frontRailCount } from './carcass-cut-rules.js';
import { isChestCategory } from './category-rules.js';
import { isBundledOtherHardware } from './hardware-facts.js';
import {
  isCmfPlaceholderLine,
  isDecorativeFinishName,
  isDepartmentFooterName,
  isProcessStandardLine,
  isProfileDimensionAnnotation,
} from './sanitize-bom-lines.js';

export type ReviewSeverity = 'block' | 'warn';
export type ReviewIssueCode =
  | 'missing_price'
  | 'missing_qty'
  | 'missing_thickness'
  | 'unmatched'
  | 'template_pending'
  | 'low_confidence'
  | 'inferred_cut'
  | 'front_rail_qty_conflict';

export type ReviewIssue = {
  lineId?: string;
  materialName: string;
  code: ReviewIssueCode;
  severity: ReviewSeverity;
  message: string;
};

export type ProvenanceTag =
  | '设计明示'
  | '规则开料'
  | '模板补全'
  | '库价'
  | '本单补价'
  | '人工修改';

export type ReviewLineInput = {
  id?: string;
  materialName: string;
  category: string;
  origin: string;
  isManual: boolean;
  confidence: string;
  matchStatus: string;
  unitPriceOverride: number | null;
  effectiveUnitPrice: number | null;
  qtyNet: number;
  spec?: string | null;
  unit?: string;
};

const BLOCKER_MESSAGES: Record<ComputeBlocker['reason'], string> = {
  missing_price: '缺少单价（价目未匹配且未填本单补价）',
  missing_qty: '缺少有效用量',
  missing_thickness: '缺少板厚，无法匹配张价',
};

function issueKey(issue: Pick<ReviewIssue, 'lineId' | 'code'>): string {
  return `${issue.lineId ?? ''}:${issue.code}`;
}

function isInferredCutLine(line: ReviewLineInput): boolean {
  if (line.category !== '板材' || line.origin !== 'template') return false;
  return /侧板|顶底|背板|抽面|抽侧|抽后|抽底|拉条|桌面|台面|横撑/.test(line.materialName);
}

export function lineProvenanceTags(line: {
  origin: string;
  category: string;
  isManual: boolean;
  matchStatus: string;
  unitPriceOverride: number | null;
  materialName?: string;
}): ProvenanceTag[] {
  const tags: ProvenanceTag[] = [];
  const inferredCut =
    line.category === '板材' &&
    line.origin === 'template' &&
    /侧板|顶底|背板|抽面|抽侧|抽后|抽底|拉条|桌面|台面|横撑/.test(line.materialName ?? '');

  if (line.origin === 'explicit' && !inferredCut) tags.push('设计明示');
  if (inferredCut) tags.push('规则开料');
  if (line.origin === 'template' && !inferredCut) tags.push('模板补全');
  if (line.matchStatus === 'exact' || line.matchStatus === 'name_only') tags.push('库价');
  if (line.unitPriceOverride !== null) tags.push('本单补价');
  if (line.isManual) tags.push('人工修改');
  return tags;
}

export function listReviewIssues(input: {
  blockers: ComputeBlocker[];
  lines: ReviewLineInput[];
  drawerCount?: number | null;
  category?: string | null;
}): ReviewIssue[] {
  const seen = new Set<string>();
  const issues: ReviewIssue[] = [];

  const push = (issue: ReviewIssue) => {
    const key = issueKey(issue);
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const blocker of input.blockers) {
    push({
      lineId: blocker.lineId,
      materialName: blocker.materialName,
      code: blocker.reason,
      severity: 'block',
      message: BLOCKER_MESSAGES[blocker.reason],
    });
  }

  const blockerLineIds = new Set(
    input.blockers.filter((item) => item.lineId).map((item) => item.lineId!),
  );

  for (const line of input.lines) {
    if (isRolledProcessLine(line.category, line.materialName)) continue;
    if (isBundledOtherHardware(line.materialName)) continue;
    if (isDepartmentFooterName(line.materialName)) continue;
    if (isDecorativeFinishName(line.materialName)) continue;
    if (isProfileDimensionAnnotation(line)) continue;
    if (isCmfPlaceholderLine(line)) continue;
    if (isProcessStandardLine(line)) continue;

    const inferredCut = isInferredCutLine(line);
    if (inferredCut) {
      push({
        lineId: line.id,
        materialName: line.materialName,
        code: 'inferred_cut',
        severity: 'warn',
        message: '规则开料尺寸，请核对是否与业务表一致',
      });
    }

    if (
      line.matchStatus === 'unmatched' &&
      line.effectiveUnitPrice === null &&
      !blockerLineIds.has(line.id ?? '')
    ) {
      push({
        lineId: line.id,
        materialName: line.materialName,
        code: 'unmatched',
        severity: 'warn',
        message: '价目未匹配，请确认规格或填写本单补价',
      });
    }

    if (line.origin === 'template' && !line.isManual && !inferredCut) {
      push({
        lineId: line.id,
        materialName: line.materialName,
        code: 'template_pending',
        severity: 'warn',
        message: '模板补全行，请核对数量与规格',
      });
    }

    if (line.confidence === 'low') {
      push({
        lineId: line.id,
        materialName: line.materialName,
        code: 'low_confidence',
        severity: 'warn',
        message: '低置信识别，请核对名称与尺寸',
      });
    }
  }

  const drawers =
    typeof input.drawerCount === 'number' && input.drawerCount > 0 ? input.drawerCount : null;
  if (drawers && isChestCategory(input.category)) {
    const formulaQty = frontRailCount(drawers);
    for (const line of input.lines) {
      if (line.materialName !== '前拉条' || line.origin !== 'explicit' || !(line.qtyNet > 0)) continue;
      if (line.qtyNet === formulaQty) continue;
      push({
        lineId: line.id,
        materialName: line.materialName,
        code: 'front_rail_qty_conflict',
        severity: 'warn',
        message: `前拉条：爆炸图 ${line.qtyNet} 根，规则公式 ${formulaQty} 根（${drawers} 抽），请核对`,
      });
    }
  }

  issues.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'block' ? -1 : 1;
    return left.materialName.localeCompare(right.materialName, 'zh-CN');
  });

  return issues;
}
