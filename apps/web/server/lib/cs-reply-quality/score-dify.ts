import { getDifyBaseUrl, isDifyKeyConfigured, runWorkflow } from '../../integrations/dify.js';
import type { CsReplyScoreDetail } from '@scm/db';
import { getCsReplyPassThreshold } from './config.js';

export type CsReplyScoreResult = {
  overallScore: number;
  scoreDetail: CsReplyScoreDetail;
  feedback: string;
  highlights: string[];
  issues: string[];
  pass: boolean;
  parseOk: boolean;
};

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseScoreDetail(raw: unknown): CsReplyScoreDetail {
  const detail = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    accuracy: clampScore(detail.accuracy),
    professionalism: clampScore(detail.professionalism),
    empathy: clampScore(detail.empathy),
    resolution: clampScore(detail.resolution),
  };
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export function isCsReplyDifyEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_CS_REPLY_QUALITY');
}

export type CsReplyDifyAppInfo = {
  name?: string;
  mode?: string;
  workflowReady: boolean;
  error?: string;
};

export async function getCsReplyDifyAppInfo(): Promise<CsReplyDifyAppInfo> {
  if (!isCsReplyDifyEnabled()) {
    return { workflowReady: false, error: '未配置 DIFY_API_KEY_CS_REPLY_QUALITY' };
  }

  const base = getDifyBaseUrl();
  const apiKey = process.env.DIFY_API_KEY_CS_REPLY_QUALITY!;

  try {
    const res = await fetch(`${base}/info`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { workflowReady: false, error: `Dify /info ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { name?: string; mode?: string };
    const workflowReady = data.mode === 'workflow';
    return {
      name: data.name,
      mode: data.mode,
      workflowReady,
      error: workflowReady
        ? undefined
        : `当前 Key 对应「${data.name ?? '未知应用'}」（${data.mode ?? '未知模式'}），请改用 Workflow 应用 API Key`,
    };
  } catch (err) {
    return {
      workflowReady: false,
      error: err instanceof Error ? err.message : '无法连接 Dify',
    };
  }
}

export function parseCsReplyWorkflowOutputs(outputs: Record<string, unknown>): CsReplyScoreResult {
  const threshold = getCsReplyPassThreshold();
  const parseOk = String(outputs.parse_ok ?? 'true') === 'true';

  let scoreDetail: CsReplyScoreDetail = {
    accuracy: 0,
    professionalism: 0,
    empathy: 0,
    resolution: 0,
  };

  if (typeof outputs.score_detail === 'string' && outputs.score_detail.trim()) {
    try {
      scoreDetail = parseScoreDetail(JSON.parse(outputs.score_detail));
    } catch {
      scoreDetail = parseScoreDetail(outputs.score_detail);
    }
  } else if (outputs.score_detail && typeof outputs.score_detail === 'object') {
    scoreDetail = parseScoreDetail(outputs.score_detail);
  }

  let overallScore = clampScore(outputs.overall_score);
  if (!overallScore) {
    overallScore = Math.round(
      scoreDetail.accuracy * 0.3 +
        scoreDetail.professionalism * 0.2 +
        scoreDetail.empathy * 0.2 +
        scoreDetail.resolution * 0.3,
    );
  }

  const feedback = typeof outputs.feedback === 'string' ? outputs.feedback.trim() : '';
  const highlights =
    typeof outputs.highlights_json === 'string'
      ? asStringArray(JSON.parse(outputs.highlights_json))
      : asStringArray(outputs.highlights);
  const issues =
    typeof outputs.issues_json === 'string'
      ? asStringArray(JSON.parse(outputs.issues_json))
      : asStringArray(outputs.issues);

  const pass =
    typeof outputs.pass === 'string'
      ? outputs.pass === 'true'
      : overallScore >= threshold;

  return {
    overallScore,
    scoreDetail,
    feedback,
    highlights,
    issues,
    pass,
    parseOk,
  };
}

export async function scoreCsReplyWithDify(params: {
  buyerMessage: string;
  agentReply: string;
  messageType?: string | null;
  orderNo?: string | null;
  agentName?: string | null;
  buyerEmail?: string | null;
  passThreshold?: number;
  userId?: string;
}): Promise<CsReplyScoreResult> {
  const outputs = await runWorkflow(
    'DIFY_API_KEY_CS_REPLY_QUALITY',
    {
      buyer_message: params.buyerMessage,
      agent_reply: params.agentReply,
      message_type: params.messageType || '售后',
      order_no: params.orderNo || '',
      agent_name: params.agentName || '',
      buyer_email: params.buyerEmail || '',
      pass_threshold: params.passThreshold ?? getCsReplyPassThreshold(),
    },
    params.userId ?? 'cs-quality',
  );

  return parseCsReplyWorkflowOutputs(outputs);
}
