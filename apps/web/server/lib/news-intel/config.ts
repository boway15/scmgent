export function isNewsIntelEnabled(): boolean {
  return process.env.NEWS_INTEL_ENABLED !== 'false';
}

export function getNewsIntelMinRelevance(): number {
  const n = Number(process.env.NEWS_INTEL_MIN_RELEVANCE ?? 40);
  return Number.isFinite(n) ? n : 40;
}

export function getNewsIntelAutoPublishThreshold(): number {
  const n = Number(process.env.NEWS_INTEL_AUTO_PUBLISH_THRESHOLD ?? 70);
  return Number.isFinite(n) ? n : 70;
}

export function isNewsIntelLlmEnabled(): boolean {
  return process.env.NEWS_INTEL_LLM_ENABLED !== 'false';
}

export function getNewsIntelMaxBodyChars(): number {
  const n = Number(process.env.NEWS_INTEL_MAX_BODY_CHARS ?? 20_000);
  return Number.isFinite(n) ? n : 20_000;
}

export function getRsshubBaseUrl(): string | undefined {
  const raw = process.env.RSSHUB_BASE_URL?.trim();
  return raw ? raw.replace(/\/$/, '') : undefined;
}

/** @deprecated Legacy table; do not write new records here. */
export function getNewsBitableLegacyTableId(): string | undefined {
  return process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL?.trim() || undefined;
}

export function getNewsBitableV2TableId(): string | undefined {
  return process.env.FEISHU_BITABLE_TABLE_NEWS_INTEL_V2?.trim() || undefined;
}

/** Prefer V2 table only. */
export function getNewsBitableTableId(): string | undefined {
  return getNewsBitableV2TableId();
}

export function getNewsBitableAppToken(): string | undefined {
  return process.env.FEISHU_BITABLE_APP_TOKEN?.trim() || undefined;
}

export function isNewsBitableConfigured(): boolean {
  return Boolean(getNewsBitableAppToken() && getNewsBitableV2TableId());
}

export function isJinaReaderEnabled(): boolean {
  return process.env.JINA_READER_ENABLED !== 'false';
}
