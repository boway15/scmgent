import { apiFetch, apiUrl } from './base-path';

export type LayeredForecastVersion = {
  id: string;
  versionNo: string;
  versionName: string;
  status: 'draft' | 'published' | 'archived';
  startMonth: string;
  horizonMonths: number;
  station: string;
  algoMeta?: Record<string, unknown> | null;
  createdBy?: string | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LayeredForecastNodeLevel = 'project_group' | 'category' | 'platform' | 'sku';

export type LayeredForecastNode = {
  id: string;
  versionId: string;
  level: LayeredForecastNodeLevel;
  projectGroup: string;
  category: string;
  platform: string;
  skuId: string | null;
  period: string;
  qty: number;
  systemQty: number;
  draftQty: number | null;
  locked: boolean;
  seasonalityFactor: number | null;
  trendFactor: number | null;
  peakMonth: number | null;
  manualEdited: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LayeredForecastNodesQuery = {
  level?: LayeredForecastNodeLevel;
  projectGroup?: string;
  category?: string;
  platform?: string;
  period?: string;
  limit?: number;
  offset?: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(apiUrl(path), init);
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const layeredForecastApi = {
  listVersions: () =>
    request<{ items: LayeredForecastVersion[] }>('/api/layered-forecasts/versions'),
  getVersion: (id: string) =>
    request<LayeredForecastVersion>(`/api/layered-forecasts/versions/${id}`),
  listNodes: (id: string, params: LayeredForecastNodesQuery = {}) => {
    const qs = new URLSearchParams();
    if (params.level) qs.set('level', params.level);
    if (params.projectGroup) qs.set('projectGroup', params.projectGroup);
    if (params.category) qs.set('category', params.category);
    if (params.platform) qs.set('platform', params.platform);
    if (params.period) qs.set('period', params.period);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<{ items: LayeredForecastNode[]; total: number }>(
      `/api/layered-forecasts/versions/${id}/nodes${query ? `?${query}` : ''}`,
    );
  },
  generate: (body: {
    startMonth?: string;
    horizonMonths?: number;
    projectGroup?: string;
    category?: string;
  }) =>
    request<{ versionId: string; versionNo: string; nodeCount: number }>(
      '/api/layered-forecasts/generate',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  patchNode: (versionId: string, nodeId: string, body: { qty: number; cascade?: boolean }) =>
    request<{ ok: true }>(`/api/layered-forecasts/versions/${versionId}/nodes/${nodeId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  lockNode: (versionId: string, nodeId: string, locked: boolean) =>
    request<{ ok: true }>(`/api/layered-forecasts/versions/${versionId}/nodes/${nodeId}/lock`, {
      method: 'POST',
      body: JSON.stringify({ locked }),
    }),
  reconcile: (
    versionId: string,
    body: { mode: 'from_parent' | 'reset_parent_from_children'; nodeId: string },
  ) =>
    request<{ ok: true }>(`/api/layered-forecasts/versions/${versionId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  publish: (versionId: string) =>
    request<{ ok: true }>(`/api/layered-forecasts/versions/${versionId}/publish`, {
      method: 'POST',
    }),
};
