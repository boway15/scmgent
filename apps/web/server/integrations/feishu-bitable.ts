import { getTenantAccessToken } from './feishu.js';
import { MAX_ROWS } from '../lib/upload-guard.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

export type BitableRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

type ListRecordsResponse = {
  code: number;
  msg?: string;
  data?: {
    items?: BitableRecord[];
    has_more?: boolean;
    page_token?: string;
    total?: number;
  };
};

/** Normalize Bitable / import header keys for lookup. */
export function normalizeBitableKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Extract a scalar string from a Bitable field value. */
export function extractFieldValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (value > 1_000_000_000_000) {
      return formatTimestampDate(value);
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (Array.isArray(value)) {
    if (!value.length) return '';
    const parts = value
      .map((item) => extractFieldValue(item))
      .filter(Boolean);
    return parts.join(', ');
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if (typeof obj.name === 'string') return obj.name.trim();
    if (typeof obj.value === 'string' || typeof obj.value === 'number') {
      return extractFieldValue(obj.value);
    }
    if (typeof obj.date === 'string') return obj.date.trim();
  }

  return String(value).trim();
}

function formatTimestampDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function listAllRecords(appToken: string, tableId: string): Promise<BitableRecord[]> {
  const token = await getTenantAccessToken();
  const records: BitableRecord[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${FEISHU_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
    );
    url.searchParams.set('page_size', '500');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as ListRecordsResponse;
    if (body.code !== 0) {
      throw new Error(`Feishu Bitable list failed: ${body.msg ?? res.status}`);
    }

    const items = body.data?.items ?? [];
    records.push(...items);

    if (records.length > MAX_ROWS) {
      throw new Error(`Too many rows. Maximum is ${MAX_ROWS}`);
    }

    pageToken = body.data?.has_more ? body.data.page_token : undefined;
  } while (pageToken);

  return records;
}
