import { and, eq, ne } from 'drizzle-orm';
import { db, layeredForecastNodes, layeredForecastVersions } from '@scm/db';
import { LAYERED_PLATFORM_ALL } from './layered-forecast-dims.js';
import { reconcileUnlocked, scaleSubtreeByShares } from './layered-forecast-reconcile.js';

type Level = 'project_group' | 'category' | 'platform' | 'sku';

type CascadeNode = {
  level: Level;
  projectGroup: string;
  category: string;
  platform: string;
  period: string;
};

export type CascadeChildFilter =
  | {
      level: 'category';
      projectGroup: string;
      platform: typeof LAYERED_PLATFORM_ALL;
      period: string;
    }
  | {
      level: 'platform';
      projectGroup: string;
      category: string;
      platformNot: typeof LAYERED_PLATFORM_ALL;
      period: string;
    }
  | {
      level: 'sku';
      projectGroup: string;
      category: string;
      platform: string;
      period: string;
    };

function qty(value: string | number | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

export function computeImbalance(parentQty: number, childQtys: number[]): number {
  return rounded(parentQty - childQtys.reduce((sum, childQty) => sum + childQty, 0));
}

/**
 * Builds the dimensions of the immediate descendants of a hierarchy node.
 * Categories are intentionally not constrained below a project-group parent.
 */
export function buildCascadeChildFilter(node: CascadeNode): CascadeChildFilter | null {
  switch (node.level) {
    case 'project_group':
      return {
        level: 'category',
        projectGroup: node.projectGroup,
        platform: LAYERED_PLATFORM_ALL,
        period: node.period,
      };
    case 'category':
      return {
        level: 'platform',
        projectGroup: node.projectGroup,
        category: node.category,
        platformNot: LAYERED_PLATFORM_ALL,
        period: node.period,
      };
    case 'platform':
      return {
        level: 'sku',
        projectGroup: node.projectGroup,
        category: node.category,
        platform: node.platform,
        period: node.period,
      };
    case 'sku':
      return null;
  }
}

async function getDraftVersion(versionId: string) {
  const [version] = await db
    .select({ id: layeredForecastVersions.id, status: layeredForecastVersions.status })
    .from(layeredForecastVersions)
    .where(eq(layeredForecastVersions.id, versionId));
  if (!version) throw new Error('分层预测版本不存在');
  if (version.status !== 'draft') throw new Error('仅草稿版本允许修改');
  return version;
}

async function getNode(versionId: string, nodeId: string) {
  const [node] = await db
    .select()
    .from(layeredForecastNodes)
    .where(and(eq(layeredForecastNodes.versionId, versionId), eq(layeredForecastNodes.id, nodeId)));
  if (!node) throw new Error('分层预测节点不存在');
  return node;
}

async function getDirectChildren(versionId: string, node: CascadeNode) {
  const filter = buildCascadeChildFilter(node);
  if (!filter) return [];

  const conditions = [
    eq(layeredForecastNodes.versionId, versionId),
    eq(layeredForecastNodes.level, filter.level),
    eq(layeredForecastNodes.projectGroup, filter.projectGroup),
    eq(layeredForecastNodes.period, filter.period),
  ];
  if ('category' in filter) conditions.push(eq(layeredForecastNodes.category, filter.category));
  if ('platform' in filter) conditions.push(eq(layeredForecastNodes.platform, filter.platform));
  if ('platformNot' in filter) conditions.push(ne(layeredForecastNodes.platform, filter.platformNot));
  return db.select().from(layeredForecastNodes).where(and(...conditions));
}

async function cascadeFromNode(versionId: string, node: CascadeNode & { id: string; qty: string }) {
  const children = await getDirectChildren(versionId, node);
  if (!children.length) return;

  const scaled = scaleSubtreeByShares(
    qty(node.qty),
    children.map((child) => ({
      id: child.id,
      qty: qty(child.qty),
      locked: child.locked,
      shareKey: child.level === 'sku' ? qty(child.draftQty) : qty(child.qty),
    })),
  );
  const resultById = new Map(scaled.map((item) => [item.id, item]));

  for (const child of children) {
    const result = resultById.get(child.id);
    if (!result || child.locked) continue;
    await db
      .update(layeredForecastNodes)
      .set({ qty: String(result.qty), updatedAt: new Date() })
      .where(eq(layeredForecastNodes.id, child.id));
    if (child.level !== 'sku') {
      await cascadeFromNode(versionId, { ...child, qty: String(result.qty) });
    }
  }
}

export async function patchNodeQty(input: {
  versionId: string;
  nodeId: string;
  qty: number;
  cascade?: boolean;
}): Promise<void> {
  if (!Number.isFinite(input.qty) || input.qty < 0) throw new Error('预测数量必须为不小于 0 的数字');
  await getDraftVersion(input.versionId);
  const node = await getNode(input.versionId, input.nodeId);
  await db
    .update(layeredForecastNodes)
    .set({ qty: String(input.qty), manualEdited: true, updatedAt: new Date() })
    .where(eq(layeredForecastNodes.id, node.id));

  if (node.level === 'sku' && !input.cascade) return;
  await cascadeFromNode(input.versionId, { ...node, qty: String(input.qty) });
}

export async function setNodeLocked(input: {
  versionId: string;
  nodeId: string;
  locked: boolean;
}): Promise<void> {
  await getDraftVersion(input.versionId);
  const node = await getNode(input.versionId, input.nodeId);
  if (node.level !== 'sku') throw new Error('仅 SKU 节点支持锁定');
  await db
    .update(layeredForecastNodes)
    .set({ locked: input.locked, updatedAt: new Date() })
    .where(eq(layeredForecastNodes.id, node.id));
}

export async function reconcileVersion(input: {
  versionId: string;
  mode: 'from_parent' | 'reset_parent_from_children';
  nodeId: string;
}): Promise<void> {
  await getDraftVersion(input.versionId);
  const node = await getNode(input.versionId, input.nodeId);

  if (input.mode === 'from_parent') {
    if (node.level !== 'platform') throw new Error('按父层对齐仅支持平台节点');
    const children = await getDirectChildren(input.versionId, node);
    const reconciled = reconcileUnlocked({
      parentQty: qty(node.qty),
      items: children.map((child) => ({
        id: child.id,
        qty: qty(child.qty),
        draftQty: qty(child.draftQty),
        recent90Qty: qty(child.draftQty),
        locked: child.locked,
      })),
    });
    for (const result of reconciled) {
      await db
        .update(layeredForecastNodes)
        .set({ qty: String(result.qty), systemQty: String(result.systemQty), updatedAt: new Date() })
        .where(eq(layeredForecastNodes.id, result.id));
    }
    return;
  }

  const children = await getDirectChildren(input.versionId, node);
  if (!children.length) throw new Error('该节点没有可汇总的直接子节点');
  const total = children.reduce((sum, child) => sum + qty(child.qty), 0);
  await db
    .update(layeredForecastNodes)
    .set({ qty: String(total), manualEdited: true, updatedAt: new Date() })
    .where(eq(layeredForecastNodes.id, node.id));
}

export async function publishVersion(versionId: string, userId?: string | null): Promise<void> {
  await getDraftVersion(versionId);
  const nodes = await db
    .select()
    .from(layeredForecastNodes)
    .where(eq(layeredForecastNodes.versionId, versionId));
  if (nodes.some((node) => qty(node.qty) < 0)) throw new Error('预测数量不能小于 0');

  const skuQtyByPlatform = new Map<string, number>();
  for (const node of nodes) {
    if (node.level !== 'sku') continue;
    const key = [node.projectGroup, node.category, node.platform, node.period].join('\t');
    skuQtyByPlatform.set(key, (skuQtyByPlatform.get(key) ?? 0) + qty(node.qty));
  }
  for (const node of nodes) {
    if (node.level !== 'platform') continue;
    const key = [node.projectGroup, node.category, node.platform, node.period].join('\t');
    if (Math.abs(computeImbalance(qty(node.qty), [skuQtyByPlatform.get(key) ?? 0])) > 0.01) {
      throw new Error('平台节点与 SKU 子节点数量不平衡，无法发布');
    }
  }

  await db
    .update(layeredForecastVersions)
    .set({
      status: 'published',
      publishedAt: new Date(),
      publishedBy: userId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(layeredForecastVersions.id, versionId));
}
