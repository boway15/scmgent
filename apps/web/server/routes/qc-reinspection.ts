import { Hono } from 'hono';
import { requireMenu } from '../lib/rbac.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { listQcReinspection, syncQcReinspection } from '../lib/qc-reinspection-sync.js';

export const qcReinspectionRoutes = new Hono();

const menuGuard = requireMenu('quality.reinspection');

qcReinspectionRoutes.get('/quality/reinspection', menuGuard, async (c) => {
  const { page, pageSize, offset } = parseListPagination(c.req.query('page'), c.req.query('pageSize'), 20);
  const result = await listQcReinspection({
    keyword: c.req.query('keyword') || undefined,
    page,
    pageSize,
    offset,
  });
  return c.json(result);
});

qcReinspectionRoutes.post('/quality/reinspection/sync', menuGuard, async (c) => {
  try {
    const result = await syncQcReinspection();
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '二次验货同步失败';
    return c.json({ message }, 500);
  }
});
