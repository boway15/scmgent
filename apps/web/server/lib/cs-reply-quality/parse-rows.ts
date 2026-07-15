import { pickField } from '../import/parse.js';
import { isPlausibleExcelSerial, excelSerialToIsoDate } from '../turnover-date-format.js';

export type ParsedCsReplyRow = {
  rowNo: number;
  buyerEmail: string;
  sentAt: Date | null;
  agentName: string;
  messageType: string;
  orderNo: string;
  buyerMessage: string;
  agentReply: string;
};

export type CsReplyParseIssue = {
  row: number;
  field?: string;
  message: string;
};

function parseSentAt(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;

  const serial = Number(text.replace(/,/g, ''));
  if (Number.isFinite(serial) && isPlausibleExcelSerial(serial)) {
    const iso = excelSerialToIsoDate(serial);
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const normalized = text.replace(/\.\d{3}$/, '').replace(' ', 'T');
  const d = new Date(normalized.includes('T') ? normalized : text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapCsReplyRow(
  row: Record<string, string>,
  rowNo: number,
): { row?: ParsedCsReplyRow; issue?: CsReplyParseIssue } {
  const buyerMessage = pickField(row, '买家消息', 'buyer_message', 'buyermessage');
  const agentReply = pickField(row, '客服回复', 'agent_reply', 'agentreply', 'cs_reply');

  if (!buyerMessage && !agentReply) {
    return { issue: { row: rowNo, message: '买家消息与客服回复均为空，已跳过' } };
  }
  if (!agentReply) {
    return { issue: { row: rowNo, field: 'agent_reply', message: '客服回复为空' } };
  }
  if (!buyerMessage) {
    return { issue: { row: rowNo, field: 'buyer_message', message: '买家消息为空' } };
  }

  const sentAtRaw = pickField(row, '发送时间', 'sent_at', 'send_time');
  const messageType = pickField(row, '消息类型', 'message_type', 'type') || '售后';

  return {
    row: {
      rowNo,
      buyerEmail: pickField(row, '买家邮箱', 'buyer_email', 'email'),
      sentAt: parseSentAt(sentAtRaw),
      agentName: pickField(row, '回复人', 'agent_name', 'agent'),
      messageType,
      orderNo: pickField(row, '订单号', 'order_no', 'order_number'),
      buyerMessage,
      agentReply,
    },
  };
}

export function parseCsReplyRows(rows: Array<Record<string, string>>): {
  validRows: ParsedCsReplyRow[];
  issues: CsReplyParseIssue[];
} {
  const validRows: ParsedCsReplyRow[] = [];
  const issues: CsReplyParseIssue[] = [];

  rows.forEach((row, index) => {
    const rowNo = index + 2;
    const { row: parsed, issue } = mapCsReplyRow(row, rowNo);
    if (parsed) validRows.push(parsed);
    if (issue) issues.push(issue);
  });

  return { validRows, issues };
}
