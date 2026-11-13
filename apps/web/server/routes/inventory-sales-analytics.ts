import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import {
  rebuildInventorySalesCube,
  getInventorySalesCubeStatus,
  listInventorySalesCubeRows,
  getInventorySalesCubeSkuDetail,
  getInventorySalesAnalyticsOverview,
  normalizeCubeMultiFilter,
  type InventorySalesCubeQueryFilters,
} from '../lib/inventory-sales-cube.js';
import { createDownloadJob, DownloadJobLimitError } from '../lib/download-jobs.js';
import { kickDownloadWorker } from '../lib/download-worker.js';
import { parseListPagination } from '../lib/list-pagination.js';

export const inventorySalesAnalyticsRoutes = new Hono();

const MENU = 'data.inventory_sales_analytics';

function parseIncludeIdle(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** 多选 query：重复键优先；否则回退单键（可逗号分隔，兼容旧调用）。 */
function readMultiQuery(c: Context, multiKey: string, singleKey: string): string[] {
  const fromMulti = (c.req.queries(multiKey) ?? []).flatMap((item) =>
    item.split(/[,，;；]/).map((part) => part.trim()).filter(Boolean),
  );
  if (fromMulti.length) return [...new Set(fromMulti)];
  const single = c.req.query(singleKey)?.trim();
  if (!single) return [];
  return [
    ...new Set(
      single
        .split(/[,，;；]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function parseAnalyticsFilters(c: Context): InventorySalesCubeQueryFilters {
  return {
    q: c.req.query('q')?.trim(),
    warehouseCodes: normalizeCubeMultiFilter(
      readMultiQuery(c, 'warehouseCodes', 'warehouseCode'),
      '仓库',
    ),
    categories: normalizeCubeMultiFilter(readMultiQuery(c, 'categories', 'category'), '品类'),
    lifecycles: normalizeCubeMultiFilter(readMultiQuery(c, 'lifecycles', 'lifecycle'), '生命周期'),
    primaryRisk: c.req.query('primaryRisk')?.trim(),
    productScope: c.req.query('productScope')?.trim(),
    salesCountry: c.req.query('salesCountry')?.trim(),
    coverBand: c.req.query('coverBand')?.trim(),
    includeIdle: parseIncludeIdle(c.req.query('includeIdle')),
  };
}

function filterParseErrorStatus(msg: string): 400 | null {
  if (/coverBand|最多选择|最多填写/i.test(msg)) return 400;
  return null;
}

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/status',
  requireMenu(MENU),
  async (c) => c.json(await getInventorySalesCubeStatus()),
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/overview',
  requireMenu(MENU),
  async (c) => {
    try {
      return c.json(await getInventorySalesAnalyticsOverview(parseAnalyticsFilters(c)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'overview failed';
      const status = filterParseErrorStatus(msg);
      if (status) return c.json({ message: msg }, status);
      throw err;
    }
  },
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/rows',
  requireMenu(MENU),
  async (c) => {
    const { page, pageSize } = parseListPagination(
      c.req.query('page')?.trim(),
      c.req.query('pageSize')?.trim(),
      20,
    );
    try {
      const result = await listInventorySalesCubeRows({
        ...parseAnalyticsFilters(c),
        page,
        pageSize,
      });
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'list failed';
      const status = filterParseErrorStatus(msg);
      if (status) return c.json({ message: msg }, status);
      throw err;
    }
  },
);

inventorySalesAnalyticsRoutes.get(
  '/inventory-sales-analytics/sku/:skuId',
  requireMenu(MENU),
  async (c) => c.json(await getInventorySalesCubeSkuDetail(c.req.param('skuId'))),
);

inventorySalesAnalyticsRoutes.post(
  '/inventory-sales-analytics/rebuild',
  requireMenu(MENU),
  async (c) => {
    const user = await getCurrentUser(c);
    try {
      const result = await rebuildInventorySalesCube({ actorId: user.id });
      // skipped（源周转未发布）正常返回 200 + result body；并发冲突由下方 catch 映射 409。
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'rebuild failed';
      if (/running|进行中|already running/i.test(msg)) return c.json({ message: msg }, 409);
      throw err;
    }
  },
);

inventorySalesAnalyticsRoutes.post(
  '/inventory-sales-analytics/export',
  requireMenu(MENU),
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json().catch(() => ({}));
    const date = new Date().toISOString().slice(0, 10);
    try {
      const created = await createDownloadJob({
        userId: user.id,
        jobType: 'inventory_sales_analytics',
        title: `存销分析导出-${date}`,
        fileName: `inventory-sales-analytics-${date}.csv`,
        params: body ?? {},
      });
      kickDownloadWorker();
      return c.json(
        { jobId: created.id, status: created.status, downloadCenterPath: '/downloads' },
        202,
      );
    } catch (err) {
      if (err instanceof DownloadJobLimitError) {
        return c.json({ message: err.message }, 429);
      }
      throw err;
    }
  },
);
