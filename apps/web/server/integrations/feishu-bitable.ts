import { getTenantAccessToken } from './feishu.js';
import { getMaxRows } from '../lib/upload-guard.js';

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

export async function listAllRecords(
  appToken: string,
  tableId: string,
  importType?: string,
): Promise<BitableRecord[]> {
  const maxRows = getMaxRows(importType);
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

    if (records.length > maxRows) {
      throw new Error(`Too many rows. Maximum is ${maxRows}`);
    }

    pageToken = body.data?.has_more ? body.data.page_token : undefined;
  } while (pageToken);

  return records;
}

type MutateRecordsResponse = {
  code: number;
  msg?: string;
  data?: {
    record?: { record_id: string };
    records?: Array<{ record_id: string }>;
    field?: { field_id: string; field_name: string; type: number };
  };
};

export type BitableFieldMeta = {
  field_id: string;
  field_name: string;
  type: number;
  ui_type?: string;
};

/** Pure helper: which required names are absent from an existing field-name set. */
export function missingBitableFieldNames(
  requiredNames: string[],
  existingNames: Iterable<string>,
): string[] {
  const existing = new Set(
    [...existingNames].map((name) => name.trim()).filter(Boolean),
  );
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const name of requiredNames) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed) || existing.has(trimmed)) continue;
    seen.add(trimmed);
    missing.push(trimmed);
  }
  return missing;
}

/**
 * Keep only field keys that exist on the Feishu table.
 * Extra Feishu columns are left untouched; unknown local keys are dropped
 * to avoid FieldNameNotFound on create/update.
 */
export function pickExistingBitableFields(
  fields: Record<string, unknown>,
  existingNames: Iterable<string>,
): Record<string, unknown> {
  const existing = new Set(
    [...existingNames].map((name) => name.trim()).filter(Boolean),
  );
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (existing.has(key)) picked[key] = value;
  }
  return picked;
}

async function bitableFetch(
  path: string,
  init?: RequestInit,
): Promise<MutateRecordsResponse> {
  const token = await getTenantAccessToken();
  const res = await fetch(`${FEISHU_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as MutateRecordsResponse;
  if (body.code !== 0) {
    throw new Error(`Feishu Bitable API failed: ${body.msg ?? res.status}`);
  }
  return body;
}

export async function listBitableFields(
  appToken: string,
  tableId: string,
): Promise<BitableFieldMeta[]> {
  const token = await getTenantAccessToken();
  const fields: BitableFieldMeta[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${FEISHU_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
    );
    url.searchParams.set('page_size', '100');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as {
      code: number;
      msg?: string;
      data?: {
        items?: BitableFieldMeta[];
        has_more?: boolean;
        page_token?: string;
      };
    };
    if (body.code !== 0) {
      throw new Error(`Feishu Bitable list fields failed: ${body.msg ?? res.status}`);
    }

    fields.push(...(body.data?.items ?? []));
    pageToken = body.data?.has_more ? body.data.page_token : undefined;
  } while (pageToken);

  return fields;
}

export async function createBitableTextField(
  appToken: string,
  tableId: string,
  fieldName: string,
): Promise<void> {
  await createBitableField(appToken, tableId, { field_name: fieldName, type: 1 });
}

export type BitableFieldCreateInput = {
  field_name: string;
  /** Feishu field type: 1 text, 2 number, 3 single, 4 multi, 5 datetime, 7 checkbox, 15 url */
  type: number;
  property?: Record<string, unknown>;
};

export async function createBitableField(
  appToken: string,
  tableId: string,
  input: BitableFieldCreateInput,
): Promise<void> {
  await bitableFetch(
    `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

/**
 * Ensure every required field name exists as a Text column on the Feishu table.
 * Creates missing fields (rate-limited); does not rename or change existing types.
 */
export async function ensureBitableTextFields(
  appToken: string,
  tableId: string,
  requiredNames: string[],
): Promise<{ existing: string[]; created: string[] }> {
  const current = await listBitableFields(appToken, tableId);
  const existing = current.map((f) => f.field_name);
  const toCreate = missingBitableFieldNames(requiredNames, existing);
  const created: string[] = [];

  for (const name of toCreate) {
    await createBitableTextField(appToken, tableId, name);
    created.push(name);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return { existing, created };
}

/**
 * Ensure typed fields exist. Skips names already present (does not alter type).
 */
export async function ensureBitableFields(
  appToken: string,
  tableId: string,
  required: BitableFieldCreateInput[],
): Promise<{ existing: string[]; created: string[]; skippedExisting: string[] }> {
  const current = await listBitableFields(appToken, tableId);
  const existing = current.map((f) => f.field_name);
  const existingSet = new Set(existing.map((n) => n.trim()));
  const created: string[] = [];
  const skippedExisting: string[] = [];

  for (const field of required) {
    const name = field.field_name.trim();
    if (!name) continue;
    if (existingSet.has(name)) {
      skippedExisting.push(name);
      continue;
    }
    await createBitableField(appToken, tableId, field);
    created.push(name);
    existingSet.add(name);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return { existing, created, skippedExisting };
}

export async function createBitableRecord(
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const body = await bitableFetch(
    `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`,
    {
      method: 'POST',
      body: JSON.stringify({ fields }),
    },
  );
  const recordId = body.data?.record?.record_id;
  if (!recordId) throw new Error('Feishu Bitable create returned no record_id');
  return recordId;
}

export async function updateBitableRecord(
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await bitableFetch(
    `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    },
  );
}

export async function batchCreateBitableRecords(
  appToken: string,
  tableId: string,
  records: Array<Record<string, unknown>>,
): Promise<string[]> {
  if (!records.length) return [];
  const ids: string[] = [];
  const chunkSize = 50;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const body = await bitableFetch(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
      {
        method: 'POST',
        body: JSON.stringify({ records: chunk.map((fields) => ({ fields })) }),
      },
    );
    const created = body.data?.records ?? [];
    for (const row of created) {
      if (row.record_id) ids.push(row.record_id);
    }
  }
  return ids;
}

export async function batchUpdateBitableRecords(
  appToken: string,
  tableId: string,
  records: Array<{ recordId: string; fields: Record<string, unknown> }>,
): Promise<void> {
  if (!records.length) return;
  const chunkSize = 50;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    await bitableFetch(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_update`,
      {
        method: 'POST',
        body: JSON.stringify({
          records: chunk.map((row) => ({
            record_id: row.recordId,
            fields: row.fields,
          })),
        }),
      },
    );
  }
}

export async function batchDeleteBitableRecords(
  appToken: string,
  tableId: string,
  recordIds: string[],
): Promise<void> {
  if (!recordIds.length) return;
  const chunkSize = 50;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    await bitableFetch(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_delete`,
      {
        method: 'POST',
        body: JSON.stringify({ records: chunk }),
      },
    );
  }
}
