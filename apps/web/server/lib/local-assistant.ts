import { eq, and, desc } from 'drizzle-orm';
import { db, skus, stockAlerts, reorderSuggestions, inventoryRecords } from '@scm/db';
import { getLatestInventorySnapshot, getLatestInProductionQty } from './inventory-snapshot.js';
import { IN_PRODUCTION_WAREHOUSE, isPhysicalWarehouse } from './inventory-constants.js';

type FaqEntry = {
  keywords: string[];
  answer: string;
};

const FAQ: FaqEntry[] = [
  {
    keywords: ['安全库存', 'safety stock', '安全水位'],
    answer:
      '安全库存用于缓冲需求波动与交期不确定性。系统支持两种方式：\n1. 手动设置：在「库存管理 > 安全库存设置」逐 SKU 编辑。\n2. 自动计算：基于近 90 天销量，用 ROP/EOQ 本地算法计算（需先有销量历史）。\n\n完整标准：安全库存 + ROP（补货触发点）+ EOQ（建议补货量）。',
  },
  {
    keywords: ['rop', '补货点', 'reorder point'],
    answer:
      'ROP（Reorder Point）= 平均日销量 × 采购交期 + 安全库存。\n当有效供给（可售+在途+在产）低于 ROP 时，系统会生成补货建议或触发预警。',
  },
  {
    keywords: ['eoq', '经济订货', '订货批量'],
    answer:
      'EOQ（经济订货量）平衡订货成本与持有成本，公式 √(2×年需求×订货成本/持有成本)。\n补货预测任务会更新 EOQ 并写入建议补货量。',
  },
  {
    keywords: ['补货建议', '补货预测', 'replenish'],
    answer:
      '流程：运行「补货预测」→ 生成建议行 → 采纳后合并到同商家草稿计划 → 在计划列表确认 → 生成采购跟单。\n建议原因列展示算法依据（有效供给、日均销量、ROP 等）。',
  },
  {
    keywords: ['pmc', '需求计划', '下单计划', '计划列表'],
    answer:
      'PMC 需求计划是平台向商家下发的 SKU×数量×交期计划（不含 BOM）。\n草稿计划可按商家+目标仓合并；确认前可导出 CSV 人工发给商家；确认后生成内部采购跟单台账。',
  },
  {
    keywords: ['采购跟单', '跟单'],
    answer:
      '采购跟单是计划确认后的内部履约台账，不是正式采购单。\n用于标记是否已跟进商家，可在「下单计划 > 采购跟单」查看。',
  },
  {
    keywords: ['缺货预警', '预警', 'alert', 'stockout'],
    answer:
      '缺货预警每日检测（可手动触发）：有效供给低于 ROP 或安全库存时写入预警列表。\n处理建议：查看补货建议 → 采纳并入计划 → 导出计划发给商家。',
  },
  {
    keywords: ['销量', '导入', 'csv', '数据导入'],
    answer:
      '销量历史通过「数据中心 > 数据导入」录入，用于安全库存与补货算法。\n支持 SKU、库存、销量、安全库存、PMC 计划等类型。',
  },
  {
    keywords: ['亮灯', '红灯', '黄灯', '绿灯', 'replenish light'],
    answer:
      'SKU 补货亮灯在「商品主数据 > SKU」维护：\n• 红灯：低于 ROP 时必须补货（如 SKU-HM-001 硅胶铲勺五件套）\n• 黄灯：低于 ROP 时，仅当同 SPU 有红灯 SKU 也需补货才生成建议（如 SKU-HM-002 与 SPU-KIT-001 联动）\n• 绿灯：不参与自动补货建议（如 SKU-HM-005 床垫清库存款）\n\n库存总览展示亮灯与当前是否可补。',
  },
  {
    keywords: ['有效供给', '在途', '在产'],
    answer:
      '分仓有效供给 = 可售 + 在途（在途已指向目的仓）。在产为 SKU 级未分仓池，货物发出后才计入目的仓在途。\n仓网/全局有效供给 = 各仓（可售+在途）之和 + 在产池。补货与预警按仓比较 ROP，仓网互调时参考全局池。',
  },
];

function matchFaq(query: string): FaqEntry | null {
  const q = query.toLowerCase();
  for (const entry of FAQ) {
    if (entry.keywords.some((kw) => q.includes(kw.toLowerCase()))) {
      return entry;
    }
  }
  return null;
}

async function resolveSkuId(skuId?: string, skuCode?: string): Promise<string | null> {
  if (skuId) return skuId;
  if (!skuCode?.trim()) return null;
  const [row] = await db.select({ id: skus.id }).from(skus).where(eq(skus.code, skuCode.trim())).limit(1);
  return row?.id ?? null;
}

export async function buildSkuContext(params: {
  skuId?: string;
  skuCode?: string;
  warehouseCode?: string;
}): Promise<string | null> {
  const id = await resolveSkuId(params.skuId, params.skuCode);
  if (!id) return null;

  const [sku] = await db.select().from(skus).where(eq(skus.id, id)).limit(1);
  if (!sku) return null;

  const lines: string[] = [`【SKU 上下文】${sku.code} ${sku.name}`];

  if (params.warehouseCode) {
    const snap = await getLatestInventorySnapshot(id, params.warehouseCode);
    const inProduction = await getLatestInProductionQty(id);
    lines.push(
      `仓 ${params.warehouseCode}：可售 ${snap.qtyAvailable}，在途 ${snap.qtyInTransit}，本仓有效 ${snap.localEffectiveQty}`,
    );
    lines.push(`SKU 在产池（未分仓）：${inProduction}`);
  } else {
    const whRows = await db
      .selectDistinct({ warehouse: inventoryRecords.warehouse })
      .from(inventoryRecords)
      .where(eq(inventoryRecords.skuId, id));

    for (const { warehouse } of whRows) {
      if (!isPhysicalWarehouse(warehouse)) continue;
      const snap = await getLatestInventorySnapshot(id, warehouse);
      lines.push(
        `仓 ${warehouse}：本仓有效 ${snap.localEffectiveQty}（可售 ${snap.qtyAvailable} / 在途 ${snap.qtyInTransit}）`,
      );
    }
    const inProduction = await getLatestInProductionQty(id);
    if (inProduction > 0) {
      lines.push(`SKU 在产池（未分仓）：${inProduction}`);
    }
    if (!whRows.length) {
      lines.push('暂无库存台账记录');
    }
  }

  const pendingSuggestions = await db
    .select({
      suggestedQty: reorderSuggestions.suggestedQty,
      suggestedDate: reorderSuggestions.suggestedDate,
      reason: reorderSuggestions.reason,
      warehouseCode: reorderSuggestions.warehouseCode,
    })
    .from(reorderSuggestions)
    .where(and(eq(reorderSuggestions.skuId, id), eq(reorderSuggestions.status, 'pending')))
    .orderBy(desc(reorderSuggestions.generatedAt))
    .limit(3);

  if (pendingSuggestions.length) {
    lines.push('待处理补货建议：');
    for (const s of pendingSuggestions) {
      lines.push(
        `- 仓 ${s.warehouseCode ?? '-'}：建议 ${s.suggestedQty}，日期 ${String(s.suggestedDate).slice(0, 10)}。${s.reason ?? ''}`,
      );
    }
  }

  const openAlerts = await db
    .select({
      alertType: stockAlerts.alertType,
      currentQty: stockAlerts.currentQty,
      safetyQty: stockAlerts.safetyQty,
    })
    .from(stockAlerts)
    .where(and(eq(stockAlerts.skuId, id), eq(stockAlerts.isResolved, false)))
    .limit(5);

  if (openAlerts.length) {
    lines.push('未处理预警：');
    for (const a of openAlerts) {
      lines.push(`- ${a.alertType}：当前 ${a.currentQty}，阈值 ${a.safetyQty}`);
    }
  }

  if (sku.leadTimeDays) lines.push(`采购交期：${sku.leadTimeDays} 天`);
  if (sku.merchantCode) lines.push(`默认商家：${sku.merchantName ?? sku.merchantCode}`);

  return lines.join('\n');
}

export async function queryLocalAssistant(
  query: string,
  context?: { skuId?: string; skuCode?: string; warehouseCode?: string },
): Promise<{ answer: string; sources?: Array<{ document_name: string; content: string }> }> {
  const skuBlock = context ? await buildSkuContext(context) : null;

  const faq = matchFaq(query);
  if (faq) {
    let answer = faq.answer;
    if (skuBlock) {
      answer = `${skuBlock}\n\n---\n\n${answer}`;
    }
    return {
      answer,
      sources: [{ document_name: '本地供应链 FAQ', content: faq.keywords.join('、') }],
    };
  }

  if (skuBlock && /分析|解释|状态|怎么样|如何|什么情况/.test(query)) {
    return {
      answer: `${skuBlock}\n\n建议操作：\n1. 若有效供给低于 ROP，前往「补货建议」运行预测或采纳建议。\n2. 若有预警，在「缺货预警」处理后可跳转补货建议。\n3. 确认需求后合并 PMC 计划并导出 CSV 发给商家。`,
      sources: [{ document_name: '系统实时数据', content: '库存快照 + 补货建议 + 预警' }],
    };
  }

  if (skuBlock) {
    return {
      answer: `${skuBlock}\n\n未匹配到具体 FAQ 主题。可尝试提问：安全库存如何计算？补货建议流程？PMC 计划如何下发？`,
      sources: [{ document_name: '系统实时数据', content: skuBlock.slice(0, 120) }],
    };
  }

  return {
    answer:
      '未找到相关信息。可尝试提问：\n• 安全库存 / ROP / EOQ 如何计算？\n• 补货建议与 PMC 计划流程？\n• 缺货预警如何处理？\n\n配置 DIFY_API_KEY_KNOWLEDGE 后将支持 Dify 文档 RAG 检索。',
  };
}
