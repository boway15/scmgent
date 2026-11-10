import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { getCurrentUser, getCurrentUserOptional } from '../lib/auth-context.js';
import { contentDispositionAttachment } from '../lib/csv-export.js';
import {
  cancelOwnDownloadJob,
  createDownloadJob,
  deleteOwnDownloadJob,
  DOWNLOAD_TTL_DAYS,
  DownloadJobLimitError,
  expireDownloadJobs,
  failStaleRunningDownloadJobs,
  getOwnDownloadJob,
  listOwnDownloadJobs,
  parseJobParams,
  type DownloadJobStatus,
} from '../lib/download-jobs.js';
import { openDownloadFileStream, resolveDownloadStoragePath } from '../lib/download-storage.js';
import { kickDownloadWorker } from '../lib/download-worker.js';
import { parseListPagination } from '../lib/list-pagination.js';

export const downloadRoutes = new Hono();

/** 下载中心同帮助中心：登录即可，不校验菜单权限；数据仍按 created_by 隔离 */
function serializeJob(job: Awaited<ReturnType<typeof getOwnDownloadJob>>) {
  if (!job) return null;
  return {
    id: job.id,
    jobType: job.jobType,
    title: job.title,
    fileName: job.fileName,
    status: job.status,
    fileSize: job.fileSize,
    contentType: job.contentType,
    rowCount: job.rowCount,
    errorMessage: job.errorMessage,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

downloadRoutes.get('/downloads', async (c) => {
  const user = await getCurrentUser(c);
  const { page, pageSize } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
    20,
  );
  const statusRaw = c.req.query('status')?.trim() as DownloadJobStatus | undefined;
  const allowed: DownloadJobStatus[] = [
    'pending',
    'running',
    'ready',
    'failed',
    'cancelled',
    'expired',
  ];
  const status = statusRaw && allowed.includes(statusRaw) ? statusRaw : undefined;
  const result = await listOwnDownloadJobs({
    userId: user.id,
    status,
    page,
    pageSize,
  });
  return c.json({
    items: result.items.map((job) => serializeJob(job)),
    total: result.total,
    page,
    pageSize,
    retentionDays: DOWNLOAD_TTL_DAYS,
  });
});

downloadRoutes.get('/downloads/:id', async (c) => {
  const user = await getCurrentUser(c);
  const job = await getOwnDownloadJob(c.req.param('id'), user.id);
  if (!job) return c.json({ message: '任务不存在' }, 404);
  return c.json(serializeJob(job));
});

downloadRoutes.get('/downloads/:id/file', async (c) => {
  const user = await getCurrentUser(c);
  const job = await getOwnDownloadJob(c.req.param('id'), user.id);
  if (!job) return c.json({ message: '任务不存在' }, 404);
  if (job.status === 'expired' || new Date(job.expiresAt).getTime() <= Date.now()) {
    return c.json({ message: '文件已过期，请重新导出' }, 410);
  }
  if (job.status !== 'ready' || !job.storagePath) {
    return c.json({ message: '文件尚未就绪' }, 409);
  }
  try {
    resolveDownloadStoragePath(job.storagePath);
    const { stream, size } = await openDownloadFileStream(job.storagePath);
    const body = Readable.toWeb(stream);
    return new Response(body as BodyInit, {
      headers: {
        'Content-Type': job.contentType || 'application/octet-stream',
        'Content-Length': String(size),
        'Content-Disposition': contentDispositionAttachment(job.fileName),
      },
    });
  } catch {
    return c.json({ message: '文件不存在或已损坏' }, 410);
  }
});

downloadRoutes.post('/downloads/:id/retry', async (c) => {
  const user = await getCurrentUser(c);
  const job = await getOwnDownloadJob(c.req.param('id'), user.id);
  if (!job) return c.json({ message: '任务不存在' }, 404);
  if (job.status !== 'failed' && job.status !== 'cancelled' && job.status !== 'expired') {
    return c.json({ message: '仅失败/取消/过期任务可重试' }, 400);
  }
  try {
    const created = await createDownloadJob({
      userId: user.id,
      jobType: job.jobType,
      title: job.title,
      fileName: job.fileName,
      params: parseJobParams(job),
    });
    kickDownloadWorker();
    return c.json(
      {
        jobId: created.id,
        status: created.status,
        downloadCenterPath: '/downloads',
        message: '已重新加入下载队列',
      },
      202,
    );
  } catch (err) {
    if (err instanceof DownloadJobLimitError) {
      return c.json({ message: err.message }, 429);
    }
    throw err;
  }
});

downloadRoutes.post('/downloads/:id/cancel', async (c) => {
  const user = await getCurrentUser(c);
  const job = await cancelOwnDownloadJob(c.req.param('id'), user.id);
  if (!job) return c.json({ message: '任务不存在或无法取消' }, 404);
  return c.json(serializeJob(job));
});

downloadRoutes.delete('/downloads/:id', async (c) => {
  const user = await getCurrentUser(c);
  const ok = await deleteOwnDownloadJob(c.req.param('id'), user.id);
  if (!ok) return c.json({ message: '任务不存在' }, 404);
  return c.json({ ok: true });
});

/** cron / admin：过期清理 */
downloadRoutes.post('/tasks/download-jobs-cleanup', async (c) => {
  const secret = process.env.CRON_SECRET?.trim();
  const header = c.req.header('X-Cron-Secret');
  const user = await getCurrentUserOptional(c);
  const allowed = (secret && header === secret) || user?.role.code === 'super_admin';
  if (!allowed) return c.json({ message: 'Unauthorized' }, 401);
  const stale = await failStaleRunningDownloadJobs();
  const purged = await expireDownloadJobs();
  kickDownloadWorker();
  return c.json({ staleFailed: stale, purged, retentionDays: DOWNLOAD_TTL_DAYS });
});
