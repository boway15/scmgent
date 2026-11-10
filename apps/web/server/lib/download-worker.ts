import {
  claimNextPendingDownloadJob,
  DOWNLOAD_GLOBAL_CONCURRENCY,
  failStaleRunningDownloadJobs,
  markDownloadJobFailed,
  markDownloadJobReady,
  parseJobParams,
  type DownloadJobRow,
} from './download-jobs.js';
import { removeDownloadJobFiles, writeDownloadFile } from './download-storage.js';
import { runDownloadExporter, type DownloadExportResult } from './download-exporters.js';

let active = 0;
let scheduled = false;

export function kickDownloadWorker(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    void pumpDownloadWorker();
  });
}

async function pumpDownloadWorker(): Promise<void> {
  try {
    await failStaleRunningDownloadJobs();
  } catch (err) {
    console.error('[download-worker] stale cleanup error', err);
  }

  while (active < DOWNLOAD_GLOBAL_CONCURRENCY) {
    let job: DownloadJobRow | null = null;
    try {
      job = await claimNextPendingDownloadJob();
    } catch (err) {
      console.error('[download-worker] claim error', err);
      break;
    }
    if (!job) break;
    active += 1;
    void executeClaimedJob(job).finally(() => {
      active -= 1;
      kickDownloadWorker();
    });
  }
}

async function executeClaimedJob(job: DownloadJobRow): Promise<void> {
  try {
    const params = parseJobParams<Record<string, unknown>>(job);
    const result = await runDownloadExporter(job.jobType, params, job);
    await finalizeReady(job, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '导出失败';
    console.error(`[download-worker] job ${job.id} failed`, err);
    try {
      await removeDownloadJobFiles(job.id);
    } catch {
      /* ignore */
    }
    await markDownloadJobFailed(job.id, message);
  }
}

async function finalizeReady(job: DownloadJobRow, result: DownloadExportResult): Promise<void> {
  const fileName = result.fileName || job.fileName;
  const written = await writeDownloadFile(job.id, fileName, result.content);
  const ready = await markDownloadJobReady(job.id, {
    storagePath: written.storagePath,
    fileSize: written.fileSize,
    contentType: result.contentType,
    fileName,
    rowCount: result.rowCount,
  });
  if (!ready) {
    try {
      await removeDownloadJobFiles(job.id);
    } catch {
      /* ignore */
    }
  }
}
