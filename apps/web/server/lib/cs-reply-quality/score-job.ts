import { eq, and, inArray } from 'drizzle-orm';
import { db, csReplyBatches, csReplyRecords } from '@scm/db';
import { CS_REPLY_SCORE_CONCURRENCY } from './config.js';
import {
  markRecordScoreFailed,
  refreshBatchScoreCounters,
  resetBatchForScoring,
  updateRecordScore,
} from './service.js';
import { isCsReplyDifyEnabled, scoreCsReplyWithDify } from './score-dify.js';

const activeBatchJobs = new Set<string>();

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function scoreRecord(
  record: {
    id: string;
    batchId: string;
    buyerMessage: string;
    agentReply: string;
    messageType: string | null;
    orderNo: string | null;
    agentName: string | null;
    buyerEmail: string | null;
  },
  passThreshold: number,
  userId: string,
) {
  await db
    .update(csReplyRecords)
    .set({ scoreStatus: 'scoring', updatedAt: new Date() })
    .where(eq(csReplyRecords.id, record.id));

  try {
    if (!isCsReplyDifyEnabled()) {
      throw new Error('Dify 客服评分未配置（DIFY_API_KEY_CS_REPLY_QUALITY）');
    }

    const result = await scoreCsReplyWithDify({
      buyerMessage: record.buyerMessage,
      agentReply: record.agentReply,
      messageType: record.messageType,
      orderNo: record.orderNo,
      agentName: record.agentName,
      buyerEmail: record.buyerEmail,
      passThreshold,
      userId,
    });

    await updateRecordScore(record.id, {
      overallScore: result.overallScore,
      scoreDetail: result.scoreDetail,
      feedback: result.feedback,
      highlights: result.highlights,
      issues: result.issues,
      pass: result.pass,
      scoreStatus: result.parseOk ? 'scored' : 'failed',
      errorMessage: result.parseOk ? null : 'Dify 输出解析失败',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '评分失败';
    console.warn(`[cs-reply-quality] score failed record ${record.id}:`, message);
    await markRecordScoreFailed(record.id, message);
  }
}

export function scheduleCsReplyScoreJob(params: {
  batchId: string;
  userId: string;
  recordIds?: string[];
  rescore?: boolean;
}): void {
  if (activeBatchJobs.has(params.batchId)) return;
  activeBatchJobs.add(params.batchId);

  setImmediate(() => {
    void (async () => {
      try {
        const [batch] = await db
          .select()
          .from(csReplyBatches)
          .where(eq(csReplyBatches.id, params.batchId))
          .limit(1);

        if (!batch) return;

        if (params.rescore) {
          await resetBatchForScoring(params.batchId);
        }

        await db
          .update(csReplyBatches)
          .set({ status: 'scoring', updatedAt: new Date() })
          .where(eq(csReplyBatches.id, params.batchId));

        const pendingRecords = await db
          .select({
            id: csReplyRecords.id,
            batchId: csReplyRecords.batchId,
            buyerMessage: csReplyRecords.buyerMessage,
            agentReply: csReplyRecords.agentReply,
            messageType: csReplyRecords.messageType,
            orderNo: csReplyRecords.orderNo,
            agentName: csReplyRecords.agentName,
            buyerEmail: csReplyRecords.buyerEmail,
          })
          .from(csReplyRecords)
          .where(
            params.recordIds?.length
              ? and(
                  eq(csReplyRecords.batchId, params.batchId),
                  inArray(csReplyRecords.id, params.recordIds),
                )
              : and(
                  eq(csReplyRecords.batchId, params.batchId),
                  inArray(csReplyRecords.scoreStatus, ['pending', 'failed']),
                ),
          );

        await runWithConcurrency(
          pendingRecords,
          CS_REPLY_SCORE_CONCURRENCY,
          async (record) => {
            await scoreRecord(record, batch.passThreshold, params.userId);
            await refreshBatchScoreCounters(params.batchId);
          },
        );

        await refreshBatchScoreCounters(params.batchId);
      } catch (err) {
        console.error(`[cs-reply-quality] score batch ${params.batchId} failed`, err);
        await db
          .update(csReplyBatches)
          .set({
            status: 'failed',
            errorSummary: err instanceof Error ? err.message : '批量评分失败',
            updatedAt: new Date(),
          })
          .where(eq(csReplyBatches.id, params.batchId));
      } finally {
        activeBatchJobs.delete(params.batchId);
      }
    })();
  });
}

export function scheduleCsReplyRecordRescore(params: {
  recordId: string;
  userId: string;
}): void {
  setImmediate(() => {
    void (async () => {
      const [record] = await db
        .select({
          id: csReplyRecords.id,
          batchId: csReplyRecords.batchId,
          buyerMessage: csReplyRecords.buyerMessage,
          agentReply: csReplyRecords.agentReply,
          messageType: csReplyRecords.messageType,
          orderNo: csReplyRecords.orderNo,
          agentName: csReplyRecords.agentName,
          buyerEmail: csReplyRecords.buyerEmail,
        })
        .from(csReplyRecords)
        .where(eq(csReplyRecords.id, params.recordId))
        .limit(1);

      if (!record) return;

      const [batch] = await db
        .select({ passThreshold: csReplyBatches.passThreshold })
        .from(csReplyBatches)
        .where(eq(csReplyBatches.id, record.batchId))
        .limit(1);

      await scoreRecord(record, batch?.passThreshold ?? 70, params.userId);
      await refreshBatchScoreCounters(record.batchId);
    })();
  });
}
