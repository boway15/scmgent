import type { CsReplyScoreDetail } from '@scm/db';
import { buildCsv } from '../csv-export.js';
import { listCsReplyRecordsForExport, type CsReplyRecordFilters } from './service.js';

const SCORE_STATUS_LABELS: Record<string, string> = {
  pending: '待评分',
  scoring: '评分中',
  scored: '已评分',
  failed: '失败',
  skipped: '跳过',
};

function formatExportDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function detailScore(detail: CsReplyScoreDetail | null | undefined, key: keyof CsReplyScoreDetail): string {
  if (!detail) return '';
  const v = detail[key];
  return v == null ? '' : String(v);
}

export async function buildCsReplyExportCsv(
  filters: Omit<CsReplyRecordFilters, 'page' | 'pageSize'>,
): Promise<string> {
  const rows = await listCsReplyRecordsForExport(filters);

  return buildCsv(
    [
      '买家邮箱',
      '发送时间',
      '回复人',
      '消息类型',
      '订单号',
      '买家消息',
      '客服回复',
      '总分',
      '准确性',
      '专业性',
      '共情',
      '解决度',
      '是否及格',
      '评分状态',
      'AI评语',
      '批次号',
      '错误信息',
    ],
    rows.map((row) => [
      row.buyerEmail ?? '',
      formatExportDate(row.sentAt),
      row.agentName ?? '',
      row.messageType ?? '',
      row.orderNo ?? '',
      row.buyerMessage,
      row.agentReply,
      row.overallScore ?? '',
      detailScore(row.scoreDetail, 'accuracy'),
      detailScore(row.scoreDetail, 'professionalism'),
      detailScore(row.scoreDetail, 'empathy'),
      detailScore(row.scoreDetail, 'resolution'),
      row.pass == null ? '' : row.pass ? '是' : '否',
      SCORE_STATUS_LABELS[row.scoreStatus] ?? row.scoreStatus,
      row.feedback ?? '',
      row.batchNo ?? '',
      row.errorMessage ?? '',
    ]),
  );
}
