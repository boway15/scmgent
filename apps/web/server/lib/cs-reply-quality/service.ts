import { eq, desc, sql, and, gte, lte, count } from 'drizzle-orm';
import {
  db,
  csReplyBatches,
  csReplyRecords,
  users,
  type CsReplyScoreDetail,
} from '@scm/db';
import { parseXlsxBuffer } from '../import/handlers.js';
import { parseCsReplyRows } from './parse-rows.js';
import { CS_REPLY_IMPORT_CHUNK_SIZE } from './config.js';
import { scheduleCsReplyScoreJob } from './score-job.js';

function nextBatchNo(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = String(Math.floor(Math.random() * 9000) + 1000);
  return `CS${y}${m}${d}${suffix}`;
}

export async function previewCsReplyImport(buffer: ArrayBuffer) {
  const rows = await parseXlsxBuffer(buffer);
  const { validRows, issues } = parseCsReplyRows(rows);
  return {
    totalRows: rows.length,
    validRows: validRows.length,
    issueCount: issues.length,
    issues: issues.slice(0, 20),
    sample: validRows.slice(0, 5).map((row) => ({
      rowNo: row.rowNo,
      buyerEmail: row.buyerEmail,
      sentAt: row.sentAt?.toISOString() ?? null,
      agentName: row.agentName,
      messageType: row.messageType,
      orderNo: row.orderNo,
      buyerMessagePreview: row.buyerMessage.slice(0, 120),
      agentReplyPreview: row.agentReply.slice(0, 120),
    })),
  };
}

export async function createCsReplyImportBatch(params: {
  buffer: ArrayBuffer;
  name?: string;
  passThreshold?: number;
  userId: string;
  autoScore?: boolean;
}) {
  const rows = await parseXlsxBuffer(params.buffer);
  const { validRows, issues } = parseCsReplyRows(rows);

  if (!validRows.length) {
    throw new Error('没有可导入的有效行，请检查 Excel 列名与内容');
  }

  const [batch] = await db
    .insert(csReplyBatches)
    .values({
      batchNo: nextBatchNo(),
      name: params.name?.trim() || `客服消息导入 ${new Date().toISOString().slice(0, 10)}`,
      status: 'importing',
      totalRows: validRows.length,
      passThreshold: params.passThreshold ?? 70,
      createdBy: params.userId,
    })
    .returning();

  scheduleCsReplyImportJob({
    batchId: batch.id,
    rows: validRows,
    issues,
    autoScore: params.autoScore ?? true,
    userId: params.userId,
  });

  return batch;
}

export function scheduleCsReplyImportJob(params: {
  batchId: string;
  rows: ReturnType<typeof parseCsReplyRows>['validRows'];
  issues: ReturnType<typeof parseCsReplyRows>['issues'];
  autoScore: boolean;
  userId: string;
}): void {
  setImmediate(() => {
    void (async () => {
      try {
        let imported = 0;
        for (let i = 0; i < params.rows.length; i += CS_REPLY_IMPORT_CHUNK_SIZE) {
          const chunk = params.rows.slice(i, i + CS_REPLY_IMPORT_CHUNK_SIZE);
          await db.insert(csReplyRecords).values(
            chunk.map((row) => ({
              batchId: params.batchId,
              rowNo: row.rowNo,
              buyerEmail: row.buyerEmail || null,
              sentAt: row.sentAt,
              agentName: row.agentName || null,
              messageType: row.messageType || null,
              orderNo: row.orderNo || null,
              buyerMessage: row.buyerMessage,
              agentReply: row.agentReply,
            })),
          );
          imported += chunk.length;
          await db
            .update(csReplyBatches)
            .set({ importedRows: imported, updatedAt: new Date() })
            .where(eq(csReplyBatches.id, params.batchId));
        }

        const issueSummary =
          params.issues.length > 0
            ? `导入跳过 ${params.issues.length} 行：${params.issues
                .slice(0, 3)
                .map((i) => `第${i.row}行 ${i.message}`)
                .join('；')}`
            : null;

        await db
          .update(csReplyBatches)
          .set({
            status: 'imported',
            importedRows: imported,
            errorSummary: issueSummary,
            updatedAt: new Date(),
          })
          .where(eq(csReplyBatches.id, params.batchId));

        if (params.autoScore) {
          scheduleCsReplyScoreJob({ batchId: params.batchId, userId: params.userId });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '导入失败';
        await db
          .update(csReplyBatches)
          .set({
            status: 'failed',
            errorSummary: message,
            updatedAt: new Date(),
          })
          .where(eq(csReplyBatches.id, params.batchId));
        console.error(`[cs-reply-quality] import batch ${params.batchId} failed`, err);
      }
    })();
  });
}

export async function listCsReplyBatches(limit = 20) {
  return db
    .select({
      id: csReplyBatches.id,
      batchNo: csReplyBatches.batchNo,
      name: csReplyBatches.name,
      status: csReplyBatches.status,
      totalRows: csReplyBatches.totalRows,
      importedRows: csReplyBatches.importedRows,
      scoredRows: csReplyBatches.scoredRows,
      failedRows: csReplyBatches.failedRows,
      passThreshold: csReplyBatches.passThreshold,
      errorSummary: csReplyBatches.errorSummary,
      createdAt: csReplyBatches.createdAt,
      updatedAt: csReplyBatches.updatedAt,
      createdByName: users.name,
    })
    .from(csReplyBatches)
    .leftJoin(users, eq(csReplyBatches.createdBy, users.id))
    .orderBy(desc(csReplyBatches.createdAt))
    .limit(limit);
}

export async function getCsReplyOverview() {
  const [totals] = await db
    .select({
      totalRecords: count(),
      scoredRecords: sql<number>`count(*) filter (where ${csReplyRecords.scoreStatus} = 'scored')::int`,
      pendingRecords: sql<number>`count(*) filter (where ${csReplyRecords.scoreStatus} = 'pending')::int`,
      failedRecords: sql<number>`count(*) filter (where ${csReplyRecords.scoreStatus} = 'failed')::int`,
      avgScore: sql<number>`coalesce(avg(${csReplyRecords.overallScore}) filter (where ${csReplyRecords.scoreStatus} = 'scored'), 0)::float`,
      passCount: sql<number>`count(*) filter (where ${csReplyRecords.pass} = true)::int`,
    })
    .from(csReplyRecords);

  const agentStats = await db
    .select({
      agentName: csReplyRecords.agentName,
      count: sql<number>`count(*)::int`,
      avgScore: sql<number>`coalesce(avg(${csReplyRecords.overallScore}), 0)::float`,
      passRate: sql<number>`coalesce(avg(case when ${csReplyRecords.pass} then 1.0 else 0.0 end), 0)::float`,
    })
    .from(csReplyRecords)
    .where(eq(csReplyRecords.scoreStatus, 'scored'))
    .groupBy(csReplyRecords.agentName)
    .orderBy(desc(sql`avg(${csReplyRecords.overallScore})`))
    .limit(10);

  return {
    totalRecords: totals?.totalRecords ?? 0,
    scoredRecords: totals?.scoredRecords ?? 0,
    pendingRecords: totals?.pendingRecords ?? 0,
    failedRecords: totals?.failedRecords ?? 0,
    avgScore: Math.round((totals?.avgScore ?? 0) * 10) / 10,
    passRate:
      totals?.scoredRecords && totals.scoredRecords > 0
        ? Math.round(((totals.passCount ?? 0) / totals.scoredRecords) * 1000) / 10
        : 0,
    topAgents: agentStats.map((row) => ({
      agentName: row.agentName || '未填写',
      count: row.count,
      avgScore: Math.round(row.avgScore * 10) / 10,
      passRate: Math.round(row.passRate * 1000) / 10,
    })),
  };
}

export type CsReplyRecordFilters = {
  batchId?: string;
  agentName?: string;
  messageType?: string;
  scoreStatus?: string;
  minScore?: number;
  maxScore?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
};

const CS_REPLY_EXPORT_MAX_ROWS = 20_000;

function buildCsReplyRecordConditions(filters: Omit<CsReplyRecordFilters, 'page' | 'pageSize'>) {
  const conditions = [];

  if (filters.batchId) conditions.push(eq(csReplyRecords.batchId, filters.batchId));
  if (filters.agentName) conditions.push(eq(csReplyRecords.agentName, filters.agentName));
  if (filters.messageType) conditions.push(eq(csReplyRecords.messageType, filters.messageType));
  if (filters.scoreStatus) {
    conditions.push(
      eq(
        csReplyRecords.scoreStatus,
        filters.scoreStatus as 'pending' | 'scoring' | 'scored' | 'failed' | 'skipped',
      ),
    );
  }
  if (filters.minScore !== undefined) {
    conditions.push(gte(csReplyRecords.overallScore, filters.minScore));
  }
  if (filters.maxScore !== undefined) {
    conditions.push(lte(csReplyRecords.overallScore, filters.maxScore));
  }
  if (filters.keyword?.trim()) {
    const kw = `%${filters.keyword.trim()}%`;
    conditions.push(
      sql`(${csReplyRecords.buyerMessage} ilike ${kw} or ${csReplyRecords.agentReply} ilike ${kw} or ${csReplyRecords.orderNo} ilike ${kw})`,
    );
  }

  return conditions.length ? and(...conditions) : undefined;
}

const csReplyRecordSelect = {
  id: csReplyRecords.id,
  batchId: csReplyRecords.batchId,
  rowNo: csReplyRecords.rowNo,
  buyerEmail: csReplyRecords.buyerEmail,
  sentAt: csReplyRecords.sentAt,
  agentName: csReplyRecords.agentName,
  messageType: csReplyRecords.messageType,
  orderNo: csReplyRecords.orderNo,
  buyerMessage: csReplyRecords.buyerMessage,
  agentReply: csReplyRecords.agentReply,
  scoreStatus: csReplyRecords.scoreStatus,
  overallScore: csReplyRecords.overallScore,
  scoreDetail: csReplyRecords.scoreDetail,
  feedback: csReplyRecords.feedback,
  highlights: csReplyRecords.highlights,
  issues: csReplyRecords.issues,
  pass: csReplyRecords.pass,
  errorMessage: csReplyRecords.errorMessage,
  scoredAt: csReplyRecords.scoredAt,
  createdAt: csReplyRecords.createdAt,
  batchNo: csReplyBatches.batchNo,
  batchName: csReplyBatches.name,
};

export async function listCsReplyRecords(filters: CsReplyRecordFilters) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const whereClause = buildCsReplyRecordConditions(filters);
  const offset = (page - 1) * pageSize;

  const [totalRow] = await db
    .select({ total: count() })
    .from(csReplyRecords)
    .where(whereClause);

  const items = await db
    .select(csReplyRecordSelect)
    .from(csReplyRecords)
    .leftJoin(csReplyBatches, eq(csReplyRecords.batchId, csReplyBatches.id))
    .where(whereClause)
    .orderBy(desc(csReplyRecords.sentAt), desc(csReplyRecords.rowNo))
    .limit(pageSize)
    .offset(offset);

  return {
    items,
    total: totalRow?.total ?? 0,
    page,
    pageSize,
  };
}

export async function listCsReplyRecordsForExport(
  filters: Omit<CsReplyRecordFilters, 'page' | 'pageSize'>,
) {
  const whereClause = buildCsReplyRecordConditions(filters);
  return db
    .select(csReplyRecordSelect)
    .from(csReplyRecords)
    .leftJoin(csReplyBatches, eq(csReplyRecords.batchId, csReplyBatches.id))
    .where(whereClause)
    .orderBy(desc(csReplyRecords.sentAt), desc(csReplyRecords.rowNo))
    .limit(CS_REPLY_EXPORT_MAX_ROWS);
}

export async function getCsReplyRecordById(id: string) {
  const [row] = await db
    .select({
      id: csReplyRecords.id,
      batchId: csReplyRecords.batchId,
      rowNo: csReplyRecords.rowNo,
      buyerEmail: csReplyRecords.buyerEmail,
      sentAt: csReplyRecords.sentAt,
      agentName: csReplyRecords.agentName,
      messageType: csReplyRecords.messageType,
      orderNo: csReplyRecords.orderNo,
      buyerMessage: csReplyRecords.buyerMessage,
      agentReply: csReplyRecords.agentReply,
      scoreStatus: csReplyRecords.scoreStatus,
      overallScore: csReplyRecords.overallScore,
      scoreDetail: csReplyRecords.scoreDetail,
      feedback: csReplyRecords.feedback,
      highlights: csReplyRecords.highlights,
      issues: csReplyRecords.issues,
      pass: csReplyRecords.pass,
      errorMessage: csReplyRecords.errorMessage,
      scoredAt: csReplyRecords.scoredAt,
      createdAt: csReplyRecords.createdAt,
      batchNo: csReplyBatches.batchNo,
      batchName: csReplyBatches.name,
      passThreshold: csReplyBatches.passThreshold,
    })
    .from(csReplyRecords)
    .leftJoin(csReplyBatches, eq(csReplyRecords.batchId, csReplyBatches.id))
    .where(eq(csReplyRecords.id, id))
    .limit(1);

  return row ?? null;
}

export async function listCsReplyAgents() {
  const rows = await db
    .selectDistinct({ agentName: csReplyRecords.agentName })
    .from(csReplyRecords)
    .where(sql`${csReplyRecords.agentName} is not null and ${csReplyRecords.agentName} <> ''`)
    .orderBy(csReplyRecords.agentName);

  return rows.map((r) => r.agentName).filter(Boolean) as string[];
}

export async function resetBatchForScoring(batchId: string) {
  await db
    .update(csReplyRecords)
    .set({
      scoreStatus: 'pending',
      overallScore: null,
      scoreDetail: null,
      feedback: null,
      highlights: null,
      issues: null,
      pass: null,
      errorMessage: null,
      scoredAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(csReplyRecords.batchId, batchId),
        sql`${csReplyRecords.scoreStatus} in ('pending', 'failed', 'scored', 'skipped')`,
      ),
    );

  await db
    .update(csReplyBatches)
    .set({
      status: 'imported',
      scoredRows: 0,
      failedRows: 0,
      updatedAt: new Date(),
    })
    .where(eq(csReplyBatches.id, batchId));
}

export async function updateRecordScore(
  recordId: string,
  result: {
    overallScore: number;
    scoreDetail: CsReplyScoreDetail;
    feedback: string;
    highlights: string[];
    issues: string[];
    pass: boolean;
    errorMessage?: string | null;
    scoreStatus: 'scored' | 'failed';
  },
) {
  await db
    .update(csReplyRecords)
    .set({
      scoreStatus: result.scoreStatus,
      overallScore: result.overallScore,
      scoreDetail: result.scoreDetail,
      feedback: result.feedback,
      highlights: result.highlights,
      issues: result.issues,
      pass: result.pass,
      errorMessage: result.errorMessage ?? null,
      scoredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(csReplyRecords.id, recordId));
}

export async function refreshBatchScoreCounters(batchId: string) {
  const [stats] = await db
    .select({
      scored: sql<number>`count(*) filter (where ${csReplyRecords.scoreStatus} = 'scored')::int`,
      failed: sql<number>`count(*) filter (where ${csReplyRecords.scoreStatus} = 'failed')::int`,
      pending: sql<number>`count(*) filter (where ${csReplyRecords.scoreStatus} in ('pending', 'scoring'))::int`,
    })
    .from(csReplyRecords)
    .where(eq(csReplyRecords.batchId, batchId));

  const scored = stats?.scored ?? 0;
  const failed = stats?.failed ?? 0;
  const pending = stats?.pending ?? 0;

  await db
    .update(csReplyBatches)
    .set({
      scoredRows: scored,
      failedRows: failed,
      status: pending > 0 ? 'scoring' : scored + failed > 0 ? 'completed' : 'imported',
      updatedAt: new Date(),
    })
    .where(eq(csReplyBatches.id, batchId));
}

export async function markRecordScoreFailed(recordId: string, errorMessage: string) {
  await db
    .update(csReplyRecords)
    .set({
      scoreStatus: 'failed',
      overallScore: null,
      scoreDetail: null,
      feedback: null,
      highlights: null,
      issues: null,
      pass: null,
      errorMessage,
      scoredAt: null,
      updatedAt: new Date(),
    })
    .where(eq(csReplyRecords.id, recordId));
}

export async function clearCsReplyData(params?: { batchId?: string }) {
  if (params?.batchId) {
    const deleted = await db
      .delete(csReplyBatches)
      .where(eq(csReplyBatches.id, params.batchId))
      .returning({ id: csReplyBatches.id });
    return { deletedBatches: deleted.length, deletedRecords: 0 };
  }

  const [recordCount] = await db.select({ total: count() }).from(csReplyRecords);
  const deleted = await db.delete(csReplyBatches).returning({ id: csReplyBatches.id });
  return {
    deletedBatches: deleted.length,
    deletedRecords: recordCount?.total ?? 0,
  };
}
