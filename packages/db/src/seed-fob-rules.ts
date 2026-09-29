import { and, eq, isNull } from 'drizzle-orm';
import { db } from './client';
import {
  fobFeeAllocationRules,
  fobPorts,
  FOB_TEMPLATE_PORT_CODE,
  FOB_TEMPLATE_PORT_NAME,
} from './schema/logistics';
import {
  FREIGHT_FEE_CATALOG,
  TRUCKING_FEE_CATALOG,
  type FeeCatalogItem,
} from './fob-fee-catalog';
import { defaultCatalogPriority } from './fob-fee-display-priority';

type RuleSeed = {
  feeType?: string;
  sourceBillType: 'trucking' | 'freight';
  matchPattern?: string;
  allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
  defaultStage: 'trucking' | 'freight' | 'customs' | 'other';
  priority: number;
  remark?: string;
};

function catalogToSeeds(
  catalog: FeeCatalogItem[],
  sourceBillType: 'trucking' | 'freight',
): RuleSeed[] {
  return catalog.map((item, index) => ({
    feeType: item.feeType,
    sourceBillType,
    allocationMethod: item.allocationMethod,
    defaultStage: item.defaultStage,
    priority: defaultCatalogPriority(sourceBillType, index),
    remark: item.remark,
  }));
}

/** 森威/华贸原表等遗留费用名（模板宽表未列出的列） */
const LEGACY_FEE_RULES: RuleSeed[] = [
  { feeType: '多点提货费', sourceBillType: 'trucking', allocationMethod: 'by_ticket', defaultStage: 'trucking', priority: 10 },
  { feeType: '超时等待费', sourceBillType: 'trucking', allocationMethod: 'by_volume', defaultStage: 'other', priority: 10 },
  { feeType: '落地寄柜费', sourceBillType: 'trucking', allocationMethod: 'by_volume', defaultStage: 'trucking', priority: 10 },
  { feeType: '延误费', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 10, remark: '需人工识别归属主体' },
  { feeType: '指定柜号', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 10, remark: '平账时指定承担主体' },
  { feeType: '其他费用', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 5 },
  { matchPattern: '海运费', sourceBillType: 'freight', allocationMethod: 'by_volume', defaultStage: 'freight', priority: 10 },
  { matchPattern: 'THC', sourceBillType: 'freight', allocationMethod: 'by_volume', defaultStage: 'freight', priority: 10 },
  { matchPattern: '码头', sourceBillType: 'freight', allocationMethod: 'by_volume', defaultStage: 'freight', priority: 10 },
  { matchPattern: '拖车费', sourceBillType: 'freight', allocationMethod: 'by_volume', defaultStage: 'trucking', priority: 10 },
];

/** 异常类模糊匹配（优先级高于精确费用名） */
const PATTERN_RULES: RuleSeed[] = [
  { matchPattern: '延误', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 15, remark: '需人工识别归属主体' },
  { matchPattern: '延误', sourceBillType: 'freight', allocationMethod: 'manual', defaultStage: 'other', priority: 15, remark: '需人工识别归属主体' },
  { matchPattern: '异常', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 20 },
  { matchPattern: '异常', sourceBillType: 'freight', allocationMethod: 'manual', defaultStage: 'other', priority: 20 },
  { matchPattern: '减免', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 20 },
  { matchPattern: '减免', sourceBillType: 'freight', allocationMethod: 'manual', defaultStage: 'other', priority: 20 },
  { matchPattern: '多收', sourceBillType: 'trucking', allocationMethod: 'manual', defaultStage: 'other', priority: 20 },
  { matchPattern: '多收', sourceBillType: 'freight', allocationMethod: 'manual', defaultStage: 'other', priority: 20 },
  { matchPattern: '报关', sourceBillType: 'freight', allocationMethod: 'by_ticket', defaultStage: 'customs', priority: 12 },
  { matchPattern: '查验', sourceBillType: 'freight', allocationMethod: 'by_ticket', defaultStage: 'customs', priority: 12 },
];

export const FOB_FEE_RULE_SEEDS: RuleSeed[] = [
  ...catalogToSeeds(TRUCKING_FEE_CATALOG, 'trucking'),
  ...catalogToSeeds(FREIGHT_FEE_CATALOG, 'freight'),
  ...LEGACY_FEE_RULES,
  ...PATTERN_RULES,
];

export async function ensureFobTemplatePort(): Promise<{ id: string }> {
  const [existing] = await db
    .select({ id: fobPorts.id })
    .from(fobPorts)
    .where(eq(fobPorts.code, FOB_TEMPLATE_PORT_CODE))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await db
    .insert(fobPorts)
    .values({
      name: FOB_TEMPLATE_PORT_NAME,
      code: FOB_TEMPLATE_PORT_CODE,
      isActive: true,
      remark: '既有全局货代规则迁入此港；可复制到真实起运港',
    })
    .returning({ id: fobPorts.id });
  return inserted;
}

async function ruleExists(seed: RuleSeed, templatePortId: string | null): Promise<boolean> {
  const portCond =
    seed.sourceBillType === 'freight'
      ? eq(fobFeeAllocationRules.portId, templatePortId!)
      : isNull(fobFeeAllocationRules.portId);

  if (seed.feeType) {
    const [row] = await db
      .select({ id: fobFeeAllocationRules.id })
      .from(fobFeeAllocationRules)
      .where(
        and(
          eq(fobFeeAllocationRules.sourceBillType, seed.sourceBillType),
          eq(fobFeeAllocationRules.feeType, seed.feeType),
          isNull(fobFeeAllocationRules.matchPattern),
          portCond,
        ),
      )
      .limit(1);
    return !!row;
  }
  if (seed.matchPattern) {
    const [row] = await db
      .select({ id: fobFeeAllocationRules.id })
      .from(fobFeeAllocationRules)
      .where(
        and(
          eq(fobFeeAllocationRules.sourceBillType, seed.sourceBillType),
          eq(fobFeeAllocationRules.matchPattern, seed.matchPattern),
          isNull(fobFeeAllocationRules.feeType),
          portCond,
        ),
      )
      .limit(1);
    return !!row;
  }
  return true;
}

/** 补齐模板费用列规则；已有库只 insert 缺失项，不覆盖用户改过的规则 */
export async function seedFobFeeRules() {
  const templatePort = await ensureFobTemplatePort();
  let inserted = 0;
  for (const rule of FOB_FEE_RULE_SEEDS) {
    if (await ruleExists(rule, templatePort.id)) continue;
    await db.insert(fobFeeAllocationRules).values({
      feeType: rule.feeType,
      sourceBillType: rule.sourceBillType,
      matchPattern: rule.matchPattern,
      allocationMethod: rule.allocationMethod,
      defaultStage: rule.defaultStage,
      priority: rule.priority,
      remark: rule.remark,
      isActive: true,
      portId: rule.sourceBillType === 'freight' ? templatePort.id : null,
    });
    inserted++;
  }
  if (inserted > 0) {
    console.log(`FOB fee rules: inserted ${inserted} missing rule(s)`);
  }
}
