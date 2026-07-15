import { isDifyKeyConfigured } from '../../integrations/dify.js';

export function isCsReplyQualityEnabled(): boolean {
  return isDifyKeyConfigured('DIFY_API_KEY_CS_REPLY_QUALITY');
}

export function getCsReplyPassThreshold(): number {
  const raw = Number(process.env.CS_REPLY_PASS_THRESHOLD ?? 70);
  if (!Number.isFinite(raw)) return 70;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export const CS_REPLY_SCORE_CONCURRENCY = Math.max(
  1,
  Math.min(5, Number(process.env.CS_REPLY_SCORE_CONCURRENCY ?? 3)),
);

export const CS_REPLY_IMPORT_CHUNK_SIZE = 200;
