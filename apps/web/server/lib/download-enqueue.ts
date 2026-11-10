import type { Context } from 'hono';
import { getCurrentUser } from './auth-context.js';
import {
  createDownloadJob,
  DownloadJobLimitError,
  type DownloadJobRow,
} from './download-jobs.js';
import { kickDownloadWorker } from './download-worker.js';

export async function enqueueDownloadJob(
  c: Context,
  input: {
    jobType: string;
    title: string;
    fileName: string;
    params: unknown;
  },
): Promise<Response> {
  const user = await getCurrentUser(c);
  try {
    const job = await createDownloadJob({
      userId: user.id,
      jobType: input.jobType,
      title: input.title,
      fileName: input.fileName,
      params: input.params,
    });
    kickDownloadWorker();
    return c.json(
      {
        jobId: job.id,
        status: job.status,
        downloadCenterPath: '/downloads',
        message: '已加入下载中心，生成完成后可下载',
      },
      202,
    );
  } catch (err) {
    if (err instanceof DownloadJobLimitError) {
      return c.json({ message: err.message }, 429);
    }
    throw err;
  }
}

export function downloadJobAcceptedPayload(job: DownloadJobRow) {
  return {
    jobId: job.id,
    status: job.status,
    downloadCenterPath: '/downloads',
    message: '已加入下载中心，生成完成后可下载',
  };
}
