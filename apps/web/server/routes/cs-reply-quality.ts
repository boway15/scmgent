import { Hono } from 'hono';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu, requireWrite } from '../lib/rbac.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { assertUploadFile } from '../lib/upload-guard.js';
import { isCsReplyQualityEnabled } from '../lib/cs-reply-quality/config.js';
import { getCsReplyDifyAppInfo } from '../lib/cs-reply-quality/score-dify.js';
import { getDifyBaseUrl } from '../integrations/dify.js';
import {
  clearCsReplyData,
  createCsReplyImportBatch,
  getCsReplyOverview,
  getCsReplyRecordById,
  listCsReplyAgents,
  listCsReplyBatches,
  listCsReplyRecords,
  previewCsReplyImport,
} from '../lib/cs-reply-quality/service.js';
import { buildCsReplyExportCsv } from '../lib/cs-reply-quality/export.js';
import { csvAttachment } from '../lib/csv-export.js';
import { scheduleCsReplyRecordRescore, scheduleCsReplyScoreJob } from '../lib/cs-reply-quality/score-job.js';

export const csReplyQualityRoutes = new Hono();

const menuGuard = requireMenu('cs.quality');

csReplyQualityRoutes.get('/cs-reply-quality/status', menuGuard, async (c) => {
  const appInfo = await getCsReplyDifyAppInfo();
  return c.json({
    difyEnabled: isCsReplyQualityEnabled() && appInfo.workflowReady,
    difyBaseUrl: getDifyBaseUrl(),
    difyAppName: appInfo.name ?? null,
    difyAppMode: appInfo.mode ?? null,
    workflowReady: appInfo.workflowReady,
    difyMessage: appInfo.error ?? null,
  });
});

csReplyQualityRoutes.get('/cs-reply-quality/overview', menuGuard, async (c) => {
  const overview = await getCsReplyOverview();
  return c.json(overview);
});

csReplyQualityRoutes.get('/cs-reply-quality/batches', menuGuard, async (c) => {
  const batches = await listCsReplyBatches(30);
  return c.json({ items: batches });
});

csReplyQualityRoutes.get('/cs-reply-quality/agents', menuGuard, async (c) => {
  const agents = await listCsReplyAgents();
  return c.json({ items: agents });
});

function parseCsReplyRecordQuery(c: { req: { query: (key: string) => string | undefined } }) {
  const minScoreRaw = c.req.query('minScore');
  const maxScoreRaw = c.req.query('maxScore');
  return {
    batchId: c.req.query('batchId') || undefined,
    agentName: c.req.query('agentName') || undefined,
    messageType: c.req.query('messageType') || undefined,
    scoreStatus: c.req.query('scoreStatus') || undefined,
    keyword: c.req.query('keyword') || undefined,
    minScore: minScoreRaw ? Number(minScoreRaw) : undefined,
    maxScore: maxScoreRaw ? Number(maxScoreRaw) : undefined,
  };
}

csReplyQualityRoutes.get('/cs-reply-quality/records/export', menuGuard, async (c) => {
  const filters = parseCsReplyRecordQuery(c);
  const csv = await buildCsReplyExportCsv(filters);
  const date = new Date().toISOString().slice(0, 10);
  return csvAttachment(`cs-reply-scores-${date}.csv`, csv);
});

csReplyQualityRoutes.get('/cs-reply-quality/records', menuGuard, async (c) => {
  const { page, pageSize } = parseListPagination(c.req.query('page'), c.req.query('pageSize'), 20);

  const result = await listCsReplyRecords({
    ...parseCsReplyRecordQuery(c),
    page,
    pageSize,
  });

  return c.json(result);
});

csReplyQualityRoutes.get('/cs-reply-quality/records/:id', menuGuard, async (c) => {
  const record = await getCsReplyRecordById(c.req.param('id'));
  if (!record) return c.json({ message: 'Not found' }, 404);
  return c.json(record);
});

csReplyQualityRoutes.post('/cs-reply-quality/import/preview', menuGuard, requireWrite(), async (c) => {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: '请上传 xlsx 文件' }, 400);
  }
  assertUploadFile(file, 'cs-reply');

  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return c.json({ message: '仅支持 .xlsx / .xls 格式' }, 400);
  }

  try {
    const buffer = await file.arrayBuffer();
    const preview = await previewCsReplyImport(buffer);
    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : '预览失败';
    return c.json({ message }, 400);
  }
});

csReplyQualityRoutes.post('/cs-reply-quality/import', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ message: '请上传 xlsx 文件' }, 400);
  }
  assertUploadFile(file, 'cs-reply');

  const name = file.name.toLowerCase();
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return c.json({ message: '仅支持 .xlsx / .xls 格式' }, 400);
  }

  const batchName = String(form.get('name') ?? '').trim() || undefined;
  const passThresholdRaw = Number(form.get('passThreshold') ?? 70);
  const passThreshold = Number.isFinite(passThresholdRaw)
    ? Math.max(0, Math.min(100, Math.round(passThresholdRaw)))
    : 70;
  const autoScore = String(form.get('autoScore') ?? 'true') !== 'false';

  try {
    const buffer = await file.arrayBuffer();
    const batch = await createCsReplyImportBatch({
      buffer,
      name: batchName,
      passThreshold,
      userId: user.id,
      autoScore,
    });
    return c.json(batch, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : '导入失败';
    return c.json({ message }, 400);
  }
});

csReplyQualityRoutes.post('/cs-reply-quality/batches/:id/score', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{ rescore?: boolean }>().catch(() => ({}));
  scheduleCsReplyScoreJob({
    batchId: c.req.param('id'),
    userId: user.id,
    rescore: body.rescore === true,
  });
  return c.json({ ok: true });
});

csReplyQualityRoutes.post('/cs-reply-quality/records/:id/rescore', menuGuard, requireWrite(), async (c) => {
  const user = await getCurrentUser(c);
  scheduleCsReplyRecordRescore({
    recordId: c.req.param('id'),
    userId: user.id,
  });
  return c.json({ ok: true });
});

csReplyQualityRoutes.post('/cs-reply-quality/clear', menuGuard, requireWrite(), async (c) => {
  const body = await c.req.json<{ batchId?: string }>().catch(() => ({}));
  const result = await clearCsReplyData({ batchId: body.batchId });
  return c.json({ ok: true, ...result });
});
