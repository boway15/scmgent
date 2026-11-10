import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { db, downloadJobs } from '@scm/db';
import { removeDownloadJobFiles } from './download-storage.js';

/** 下载文件保留天数；超时由 cron 清理并标 expired */
export const DOWNLOAD_TTL_DAYS = 15;
export const DOWNLOAD_TTL_MS = DOWNLOAD_TTL_DAYS * 24 * 60 * 60 * 1000;
export const DOWNLOAD_GLOBAL_CONCURRENCY = 2;
export const DOWNLOAD_USER_ACTIVE_LIMIT = 5;
export const DOWNLOAD_STALE_RUNNING_MS = 60 * 60 * 1000;

export type DownloadJobStatus =
  | 'pending'
  | 'running'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type DownloadJobRow = typeof downloadJobs.$inferSelect;

export class DownloadJobLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadJobLimitError';
  }
}

export async function countUserActiveDownloadJobs(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(downloadJobs)
    .where(
      and(
        eq(downloadJobs.createdBy, userId),
        inArray(downloadJobs.status, ['pending', 'running']),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function createDownloadJob(input: {
  userId: string;
  jobType: string;
  title: string;
  fileName: string;
  params: unknown;
}): Promise<DownloadJobRow> {
  const active = await countUserActiveDownloadJobs(input.userId);
  if (active >= DOWNLOAD_USER_ACTIVE_LIMIT) {
    throw new DownloadJobLimitError(
      `进行中的下载任务已达上限（${DOWNLOAD_USER_ACTIVE_LIMIT}），请稍后再试或到下载中心取消旧任务`,
    );
  }

  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MS);
  const [job] = await db
    .insert(downloadJobs)
    .values({
      createdBy: input.userId,
      jobType: input.jobType,
      title: input.title,
      fileName: input.fileName,
      paramsJson: JSON.stringify(input.params ?? {}),
      status: 'pending',
      expiresAt,
    })
    .returning();
  return job;
}

export async function getOwnDownloadJob(
  jobId: string,
  userId: string,
): Promise<DownloadJobRow | null> {
  const [job] = await db
    .select()
    .from(downloadJobs)
    .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.createdBy, userId)))
    .limit(1);
  return job ?? null;
}

export async function listOwnDownloadJobs(input: {
  userId: string;
  status?: DownloadJobStatus;
  page: number;
  pageSize: number;
}): Promise<{ items: DownloadJobRow[]; total: number }> {
  const conditions = [eq(downloadJobs.createdBy, input.userId)];
  if (input.status) conditions.push(eq(downloadJobs.status, input.status));

  const where = and(...conditions);
  const [totalRow] = await db.select({ n: count() }).from(downloadJobs).where(where);
  const items = await db
    .select()
    .from(downloadJobs)
    .where(where)
    .orderBy(desc(downloadJobs.createdAt))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  return { items, total: Number(totalRow?.n ?? 0) };
}

export async function claimNextPendingDownloadJob(): Promise<DownloadJobRow | null> {
  return db.transaction(async (tx) => {
    const [running] = await tx
      .select({ n: count() })
      .from(downloadJobs)
      .where(eq(downloadJobs.status, 'running'));
    if (Number(running?.n ?? 0) >= DOWNLOAD_GLOBAL_CONCURRENCY) return null;

    const [pending] = await tx
      .select()
      .from(downloadJobs)
      .where(eq(downloadJobs.status, 'pending'))
      .orderBy(downloadJobs.createdAt)
      .limit(1);
    if (!pending) return null;

    const [claimed] = await tx
      .update(downloadJobs)
      .set({ status: 'running' })
      .where(and(eq(downloadJobs.id, pending.id), eq(downloadJobs.status, 'pending')))
      .returning();
    return claimed ?? null;
  });
}

export async function markDownloadJobReady(
  jobId: string,
  data: {
    storagePath: string;
    fileSize: number;
    contentType: string;
    fileName?: string;
    rowCount?: number;
  },
): Promise<DownloadJobRow | null> {
  const [job] = await db
    .update(downloadJobs)
    .set({
      status: 'ready',
      storagePath: data.storagePath,
      fileSize: data.fileSize,
      contentType: data.contentType,
      ...(data.fileName ? { fileName: data.fileName } : {}),
      rowCount: data.rowCount ?? null,
      finishedAt: new Date(),
      errorMessage: null,
    })
    .where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.status, 'running')))
    .returning();
  return job ?? null;
}

export async function markDownloadJobFailed(
  jobId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(downloadJobs)
    .set({
      status: 'failed',
      errorMessage: errorMessage.slice(0, 2000),
      finishedAt: new Date(),
    })
    .where(
      and(eq(downloadJobs.id, jobId), inArray(downloadJobs.status, ['pending', 'running'])),
    );
}

export async function cancelOwnDownloadJob(
  jobId: string,
  userId: string,
): Promise<DownloadJobRow | null> {
  const [job] = await db
    .update(downloadJobs)
    .set({
      status: 'cancelled',
      finishedAt: new Date(),
      errorMessage: '用户取消',
    })
    .where(
      and(
        eq(downloadJobs.id, jobId),
        eq(downloadJobs.createdBy, userId),
        inArray(downloadJobs.status, ['pending', 'running']),
      ),
    )
    .returning();
  return job ?? null;
}

export async function deleteOwnDownloadJob(
  jobId: string,
  userId: string,
): Promise<boolean> {
  const job = await getOwnDownloadJob(jobId, userId);
  if (!job) return false;
  await db.delete(downloadJobs).where(and(eq(downloadJobs.id, jobId), eq(downloadJobs.createdBy, userId)));
  try {
    await removeDownloadJobFiles(jobId);
  } catch {
    /* ignore */
  }
  return true;
}

export async function failStaleRunningDownloadJobs(
  maxAgeMs = DOWNLOAD_STALE_RUNNING_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await db
    .update(downloadJobs)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage: '任务超时或进程中断，已自动标记失败',
    })
    .where(and(eq(downloadJobs.status, 'running'), lt(downloadJobs.createdAt, cutoff)))
    .returning({ id: downloadJobs.id });
  return rows.length;
}

/**
 * 清理超过有效期的下载：删文件并物理删除记录（默认 15 天）。
 * 返回清理条数。
 */
export async function expireDownloadJobs(now = new Date()): Promise<number> {
  const due = await db
    .select({ id: downloadJobs.id })
    .from(downloadJobs)
    .where(lt(downloadJobs.expiresAt, now));

  for (const row of due) {
    try {
      await removeDownloadJobFiles(row.id);
    } catch {
      /* ignore */
    }
  }

  if (!due.length) return 0;

  const deleted = await db
    .delete(downloadJobs)
    .where(lt(downloadJobs.expiresAt, now))
    .returning({ id: downloadJobs.id });
  return deleted.length;
}

export function parseJobParams<T>(job: DownloadJobRow): T {
  try {
    return JSON.parse(job.paramsJson || '{}') as T;
  } catch {
    return {} as T;
  }
}
