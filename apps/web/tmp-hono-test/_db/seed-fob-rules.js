import { and, eq, isNull } from 'drizzle-orm';
import { db } from './client.js';
import { fobFeeAllocationRules } from './schema/logistics.js';
import { FREIGHT_FEE_CATALOG, TRUCKING_FEE_CATALOG, } from './fob-fee-catalog.js';
import { defaultCatalogPriority } from './fob-fee-display-priority.js';
function catalogToSeeds(catalog, sourceBillType) {
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
const LEGACY_FEE_RULES = [
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
const PATTERN_RULES = [
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
export const FOB_FEE_RULE_SEEDS = [
    ...catalogToSeeds(TRUCKING_FEE_CATALOG, 'trucking'),
    ...catalogToSeeds(FREIGHT_FEE_CATALOG, 'freight'),
    ...LEGACY_FEE_RULES,
    ...PATTERN_RULES,
];
async function ruleExists(seed) {
    if (seed.feeType) {
        const [row] = await db
            .select({ id: fobFeeAllocationRules.id })
            .from(fobFeeAllocationRules)
            .where(and(eq(fobFeeAllocationRules.sourceBillType, seed.sourceBillType), eq(fobFeeAllocationRules.feeType, seed.feeType), isNull(fobFeeAllocationRules.matchPattern)))
            .limit(1);
        return !!row;
    }
    if (seed.matchPattern) {
        const [row] = await db
            .select({ id: fobFeeAllocationRules.id })
            .from(fobFeeAllocationRules)
            .where(and(eq(fobFeeAllocationRules.sourceBillType, seed.sourceBillType), eq(fobFeeAllocationRules.matchPattern, seed.matchPattern), isNull(fobFeeAllocationRules.feeType)))
            .limit(1);
        return !!row;
    }
    return true;
}
/** 补齐模板费用列规则；已有库只 insert 缺失项，不覆盖用户改过的规则 */
export async function seedFobFeeRules() {
    let inserted = 0;
    for (const rule of FOB_FEE_RULE_SEEDS) {
        if (await ruleExists(rule))
            continue;
        await db.insert(fobFeeAllocationRules).values({
            feeType: rule.feeType,
            sourceBillType: rule.sourceBillType,
            matchPattern: rule.matchPattern,
            allocationMethod: rule.allocationMethod,
            defaultStage: rule.defaultStage,
            priority: rule.priority,
            remark: rule.remark,
            isActive: true,
        });
        inserted++;
    }
    if (inserted > 0) {
        console.log(`FOB fee rules: inserted ${inserted} missing rule(s)`);
    }
}
