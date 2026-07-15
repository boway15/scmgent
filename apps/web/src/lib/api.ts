import { apiFetch, apiUrl } from './base-path';
import type { HorizonBand } from './forecast-horizon-meta';

export type MenuNode = {
  id: string;
  name: string;
  code: string;
  icon?: string | null;
  path?: string | null;
  sortOrder: number;
  isLeaf: boolean;
  children?: MenuNode[];
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: { id: string; name: string; code: string };
};

export type Sku = {
  id: string;
  code: string;
  name: string;
  unit: string;
  spuId?: string | null;
  category?: string | null;
  specAttrs?: Record<string, string> | null;
  barcode?: string | null;
  leadTimeDays?: number | null;
  moq?: number | null;
  unitCost?: string | null;
  merchantCode?: string | null;
  merchantName?: string | null;
  replenishLight?: ReplenishLight;
  isActive: boolean;
};

export type PurchaseDraftStatus =
  | 'draft'
  | 'confirmed'
  | 'in_production'
  | 'ready_to_ship'
  | 'in_transit'
  | 'partial_received'
  | 'received'
  | 'exception'
  | 'cancelled';

export type ProcurementListType = 'bulk_stock_request' | 'purchase_follow_up';

export type ProcurementListConfig = {
  listType: ProcurementListType;
  label: string;
  menuCode: string;
  configured: boolean;
  appTokenConfigured: boolean;
  tableIdConfigured: boolean;
  tableEnvKey: string;
  appTokenEnvKeys: string[];
  tableId?: string;
};

export type ProcurementListMeta = {
  listType: ProcurementListType;
  label: string;
  configured: boolean;
  tableId?: string;
  columnOrder: string[];
  rowCount: number;
  lastSyncAt: string | null;
  lastSyncSource: 'feishu' | 'upload' | 'feishu_push' | null;
  lastSyncByName: string | null;
  updatedAt: string | null;
};

export type ProcurementListRow = {
  id: string;
  rowIndex: number;
  bitableRecordId?: string | null;
  rowData: Record<string, string>;
  createdAt: string;
};

export type ReplenishLight = 'red' | 'yellow' | 'green';

export type InventoryHealth = 'red' | 'yellow' | 'green' | 'blue' | 'gray';

export type Spu = {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  description?: string | null;
  moq?: number | null;
  isActive: boolean;
};

export type Merchant = {
  id: string;
  code: string;
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  countryCode?: string | null;
  paymentTerms?: string | null;
  productionLeadDays?: number | null;
  remark?: string | null;
  isActive: boolean;
};

export type SkuOverview = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category?: string | null;
  /** A 品类 */
  lifecycle?: string | null;
  /** C 生命周期 */
  salesCountry?: string | null;
  /** E 销售国家 */
  productCategory?: string | null;
  /** F 产品分类 */
  ownerName?: string | null;
  /** H 负责人 */
  developerName?: string | null;
  /** I 开发人员 */
  spuId?: string | null;
  spuCode?: string | null;
  spuName?: string | null;
  externalCode?: string | null;
  skuKind?: string | null;
  divisionCode?: string | null;
  divisionName?: string | null;
  encodingValid?: boolean;
  merchantCode?: string | null;
  merchantName?: string | null;
  leadTimeDays?: number | null;
  moq?: number | null;
  unitCost?: string | null;
  /** 库存周转表：包装长宽高cm */
  packDimensionsCm?: string | null;
  /** 库存周转表：体积（m3） */
  volumeM3?: string | null;
  /** 库存周转表：毛重（Kg） */
  grossWeightKg?: string | null;
  /** 与库存总览一致：SKU / 库存 / 周转快照最晚更新时间 */
  updatedAt?: string | null;
  replenishLight?: ReplenishLight;
  supplierCount: number;
  isActive: boolean;
};

export type InventoryOverview = {
  skuId: string;
  updatedAt?: string | null;
  inventoryRecordedDate?: string | null;
  turnoverSnapshotAt?: string | null;
  dataSource?: string | null;
  category?: string | null;
  code: string;
  lifecycle?: string | null;
  name: string;
  salesCountry?: string | null;
  productCategory?: string | null;
  merchantCode?: string | null;
  ownerName?: string | null;
  developerName?: string | null;
  merchantName?: string | null;
  leadTimeDays?: number | null;
  unitCost?: string | null;
  unit: string;
  qtyInProduction: number;
  qtyPreOrder: number;
  salesQty3d: number;
  salesQty7d: number;
  salesQty14d: number;
  salesQty30d: number;
  replenishLight: ReplenishLight;
  packDimensionsCm?: string | null;
  volumeM3?: string | null;
  grossWeightKg?: string | null;
  turnoverExtras?: Record<string, string>;
  warehouseStocks?: Array<{
    warehouseCode: string;
    qtyAvailable: number;
    qtyInTransit: number;
  }>;
};

export type ImportType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'safety_stock'
  | 'merchants'
  | 'pmc_plans';

export type BitableSyncType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'merchants'
  | 'inventory_policy';

export type BitableSyncTargetStatus = {
  configured: boolean;
  tableId?: string;
  appTokenConfigured: boolean;
};

export type TaskRunSummary = {
  id: string;
  taskName: string;
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt?: string | null;
  resultSummary?: string | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
};

export type ImportValidationIssue = {
  row: number;
  field?: string;
  message: string;
};

export type CsReplyScoreDetail = {
  accuracy: number;
  professionalism: number;
  empathy: number;
  resolution: number;
};

export type CsReplyRecordSummary = {
  id: string;
  batchId: string;
  rowNo: number;
  buyerEmail: string | null;
  sentAt: string | null;
  agentName: string | null;
  messageType: string | null;
  orderNo: string | null;
  buyerMessage: string;
  agentReply: string;
  scoreStatus: string;
  overallScore: number | null;
  scoreDetail: CsReplyScoreDetail | null;
  feedback: string | null;
  highlights: string[] | null;
  issues: string[] | null;
  pass: boolean | null;
  errorMessage: string | null;
  scoredAt: string | null;
  createdAt: string;
  batchNo: string | null;
  batchName: string | null;
};

export type CsReplyRecordDetail = CsReplyRecordSummary & {
  passThreshold: number | null;
};

export type ForecastReviewItem = {
  id: string;
  versionId: string;
  skuId: string;
  skuCode: string;
  skuName?: string;
  station: string;
  platform: string;
  issueType: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestedDailyAvg: number | null;
  reviewedDailyAvg: number | null;
  status: 'pending' | 'reviewed' | 'ignored';
  createdAt: string;
};

/** 复核清单默认按 SKU×渠道 聚合后的行 */
export type ForecastReviewItemGroup = {
  skuId: string;
  skuCode: string;
  skuName: string;
  station: string;
  platform: string;
  status: 'pending' | 'reviewed' | 'ignored';
  severity: 'critical' | 'warning' | 'info';
  issueTypes: string[];
  messages: string[];
  itemIds: string[];
  suggestedDailyAvg: number | null;
};

export type ForecastVersionSummary = {
  monthCount: number;
  monthLabels: string[];
  description: string;
};

export type ForecastVersionStats = {
  forecastRowCount: number;
  skuCount: number;
  monthCount: number;
  /** 待复核 SKU×渠道 数 */
  reviewPending: number;
  /** 待复核涉及的去重 SKU 数 */
  reviewPendingSkuCount: number;
  reviewCritical: number;
  accuracyWmape: number | null;
};

export type ForecastVersionListItem = {
  id: string;
  versionNo: string;
  versionName: string;
  station?: string | null;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  publishedAt?: string | null;
  /** 单渠道生成草稿时的渠道码；全平台或未识别时为 null */
  generationPlatform?: string | null;
  stats: ForecastVersionStats;
};

export type ForecastVersionBasic = {
  id: string;
  versionNo: string;
  versionName: string;
  station?: string | null;
  status: string;
  publishedAt?: string | null;
};

export type SkuMonthlyForecastCell = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  forecastDailyAvg: number;
  baselineDailyAvg: number | null;
  horizonFactors: {
    nearLevel: number;
    structuralLevel: number;
    yoyMonthLevel: number;
    yoyAnchorLevel: number;
    growthFactor: number;
    wNear: number;
    wYoy: number;
    horizonMonthIndex: number;
  } | null;
};

export type ForecastAccuracyMetricSummary = {
  key?: string;
  label?: string;
  rows: number;
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  ghostRows: number;
  zeroForecastMissRows: number;
  actualDailySum: number;
  forecastDailySum: number;
};

export type ForecastAccuracyDiagnostics = {
  scope: {
    versionId?: string;
    versionName?: string;
    versionStatus?: string;
    versionStation?: string | null;
    station?: string;
    platform?: string;
    startMonth?: string;
    endMonth?: string;
    asOf?: string;
    versionSelection?: 'explicit' | 'auto_published' | 'auto_latest';
  };
  dataQuality: {
    monthlyRows: number;
    monthlySkuCount: number;
    monthlyStartMonth?: string;
    monthlyEndMonth?: string;
    unknownChannelRows: number;
    unknownChannelQty: number;
    totalMonthlyQty: number;
    unknownChannelQtyRate: number | null;
    dailyMonthlyComparedRows: number;
    dailyMonthlyComparedMonths: number;
    dailyMonthlyAbsDiffQty: number;
    dailyMonthlyBaseQty: number;
    dailyMonthlyAbsDiffRate: number | null;
  };
  global: ForecastAccuracyMetricSummary;
  byHorizonBand: ForecastAccuracyMetricSummary[];
  byProfileSegment: ForecastAccuracyMetricSummary[];
  byVolumeTier: ForecastAccuracyMetricSummary[];
  byCategory: ForecastAccuracyMetricSummary[];
  topErrorSkus: Array<{
    skuId: string;
    skuCode: string;
    skuName: string;
    category: string | null;
    volumeTier: string;
    profileSegment: string;
    rows: number;
    comparableRows: number;
    wmape: number | null;
    weightedBias: number | null;
    ghostRows: number;
    zeroForecastMissRows: number;
    actualDailySum: number;
    forecastDailySum: number;
    absErrorSum: number;
  }>;
  recommendations: string[];
};

export type ForecastAccuracyReviewQueueResult = {
  sourceVersion: { id: string; versionName: string; status: string };
  targetVersion: { id: string; versionName: string; status: string };
  candidates: number;
  upserted: number;
  skippedCompleted: number;
  items: Array<{
    skuId: string;
    skuCode: string;
    skuName: string;
    station: string;
    platform: string;
    severity: 'critical' | 'warning';
    wmape: number | null;
    weightedBias: number | null;
    ghostRows: number;
    zeroForecastMissRows: number;
    suggestedDailyAvg: number | null;
  }>;
};
export type SkuForecastContext = {
  lifecycle: string;
  weights: { w90: number; w30: number; wLy: number; wCat: number };
  weightsLabel: string;
  recent30DailyAvg: number;
  recent90DailyAvg: number;
  lastYearSameMonthDailyAvg: number;
  categoryReferenceDailyAvg: number | null;
  storedBaselineDailyAvg: number | null;
  storedLifecycle: string | null;
  forecastProfileClass: string | null;
  profileSegment: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  let res: Response;
  try {
    res = await apiFetch(url, init);
  } catch (err) {
    const hint =
      typeof window !== 'undefined' && window.location.hostname === 'localhost'
        ? '（Windows Docker 请改用 http://127.0.0.1:8081 访问，localhost 可能走 IPv6 导致请求失败）'
        : '';
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg}${hint}`);
  }
  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new Error(
        `HTTP ${res.status}: 收到 HTML 而非 JSON（${url}）。Hono 可能未挂载，请运行 miaoda-sync 并重新构建。`,
      );
    }
    const text = await res.text();
    let message = res.statusText;
    try {
      const err = JSON.parse(text) as { message?: string };
      message = err.message ?? message;
    } catch {
      if (text) message = text.slice(0, 200);
    }
    if (res.status === 403 && /csrf/i.test(message)) {
      throw new Error(`HTTP 403: ${message}（需 x-suda-csrf-token 请求头）`);
    }
    throw new Error(message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getAuthConfig: () =>
    request<{
      feishuEnabled: boolean;
      emailAuthEnabled: boolean;
      authBypass: boolean;
    }>('/api/auth/config'),
  register: (data: { email: string; password: string; name?: string }) =>
    request<{ ok: boolean; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  login: (data: { email: string; password: string }) =>
    request<{ ok: boolean; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getFeishuLoginUrl: () => request<{ url: string }>('/api/auth/feishu/url'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getMe: () => request<User>('/api/me'),
  getMyMenus: () => request<MenuNode[]>('/api/me/menus'),
  getMenus: () => request<MenuNode[]>('/api/menus'),
  getUsers: () =>
    request<
      Array<{
        id: string;
        name: string;
        email: string;
        feishuUserId?: string | null;
        isActive: boolean;
        roleId: string;
        roleName: string;
        roleCode: string;
        hasPassword: boolean;
      }>
    >('/api/users'),
  updateUser: (id: string, data: { roleId?: string; isActive?: boolean; name?: string }) =>
    request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: boolean }>(`/api/users/${id}/password`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    }),
  getAuditLogs: (params?: { page?: number; pageSize?: number; action?: string; userId?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.action) q.set('action', params.action);
    if (params?.userId) q.set('userId', params.userId);
    const qs = q.toString();
    return request<{
      items: Array<{
        id: string;
        userId?: string | null;
        userName?: string | null;
        userEmail?: string | null;
        action: string;
        resourceType?: string | null;
        resourceId?: string | null;
        detail?: string | null;
        ipAddress?: string | null;
        createdAt: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/audit-logs${qs ? `?${qs}` : ''}`);
  },
  getNewsIntelStatus: () =>
    request<{
      enabled: boolean;
      bitableConfigured: boolean;
      bitableAppTokenConfigured: boolean;
      bitableTableId?: string;
      latestRun?: {
        id: string;
        status: string;
        startedAt: string;
        finishedAt?: string | null;
        resultSummary?: string | null;
        errorMessage?: string | null;
      } | null;
    }>('/api/news-intel/status'),
  getNewsIntelOverview: () =>
    request<{
      todayNew: number;
      pendingReview: number;
      highPriorityToday: number;
      sourceTotal: number;
      sourceHealthy: number;
    }>('/api/news-intel/overview'),
  getNewsIntelSources: () =>
    request<{
      items: Array<{
        id: string;
        code: string;
        name: string;
        feedUrl: string;
        sourceType: string;
        categoryDefault: string;
        enabled: boolean;
        fetchIntervalHours: number;
        lastFetchedAt?: string | null;
        lastError?: string | null;
        consecutiveFailures: number;
        configJson?: {
          channel?: string;
          includeKeywords?: string[];
          excludeKeywords?: string[];
          siteDomain?: string;
          note?: string;
        } | null;
      }>;
    }>('/api/news-intel/sources'),
  getNewsIntelPolicy: () =>
    request<{
      lookbackDays: number;
      maxItemsPerSource: number;
      channels: Record<string, { enabled: boolean; label: string }>;
      negativeKeywords: string[];
      categories: Array<{ bitableValue: string; keywords: string[] }>;
    }>('/api/news-intel/policy'),
  updateNewsIntelPolicy: (policy: Record<string, unknown>) =>
    request('/api/news-intel/policy', { method: 'PUT', body: JSON.stringify(policy) }),
  createNewsIntelSource: (data: {
    code: string;
    name: string;
    feedUrl: string;
    sourceType?: string;
    categoryDefault?: string;
    fetchIntervalHours?: number;
    enabled?: boolean;
    configJson?: {
      channel?: string;
      includeKeywords?: string[];
      excludeKeywords?: string[];
      siteDomain?: string;
      note?: string;
    };
  }) =>
    request('/api/news-intel/sources', { method: 'POST', body: JSON.stringify(data) }),
  updateNewsIntelSource: (
    id: string,
    data: {
      name?: string;
      feedUrl?: string;
      sourceType?: string;
      categoryDefault?: string;
      fetchIntervalHours?: number;
      enabled?: boolean;
      configJson?: {
        channel?: string;
        includeKeywords?: string[];
        excludeKeywords?: string[];
        siteDomain?: string;
        note?: string;
      } | null;
    },
  ) => request(`/api/news-intel/sources/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  disableNewsIntelSource: (id: string) =>
    request(`/api/news-intel/sources/${id}`, { method: 'DELETE' }),
  getNewsIntelArticles: (params?: {
    page?: number;
    pageSize?: number;
    category?: string;
    status?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.category) q.set('category', params.category);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<{
      items: Array<{
        id: string;
        title: string;
        summary?: string | null;
        category: string;
        bitableCategory?: string | null;
        relevanceScore: number;
        priority: string;
        status: string;
        canonicalUrl: string;
        fetchedAt: string;
        sourceName: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/news-intel/articles${qs ? `?${qs}` : ''}`);
  },
  getNewsIntelArticle: (id: string) => request(`/api/news-intel/articles/${id}`),
  updateNewsIntelArticle: (
    id: string,
    data: { status?: string; priority?: string; category?: string },
  ) => request(`/api/news-intel/articles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  triggerNewsIngest: (data?: { force?: boolean; sourceId?: string }) =>
    request('/api/news-intel/ingest/trigger', {
      method: 'POST',
      body: JSON.stringify(data ?? {}),
    }),
  getNewsIngestLogs: (limit = 30) =>
    request<{
      items: Array<{
        log: {
          id: string;
          fetchedCount: number;
          newCount: number;
          skippedDup: number;
          skippedLowRelevance: number;
          errorMessage?: string | null;
          durationMs?: number | null;
          createdAt: string;
        };
        sourceCode: string;
        sourceName: string;
      }>;
    }>(`/api/news-intel/ingest/logs?limit=${limit}`),
  getCsReplyQualityStatus: () =>
    request<{
      difyEnabled: boolean;
      difyBaseUrl: string;
      difyAppName: string | null;
      difyAppMode: string | null;
      workflowReady: boolean;
      difyMessage: string | null;
    }>('/api/cs-reply-quality/status'),
  getCsReplyQualityOverview: () =>
    request<{
      totalRecords: number;
      scoredRecords: number;
      pendingRecords: number;
      failedRecords: number;
      avgScore: number;
      passRate: number;
      topAgents: Array<{
        agentName: string;
        count: number;
        avgScore: number;
        passRate: number;
      }>;
    }>('/api/cs-reply-quality/overview'),
  getCsReplyBatches: () =>
    request<{
      items: Array<{
        id: string;
        batchNo: string;
        name: string | null;
        status: string;
        totalRows: number;
        importedRows: number;
        scoredRows: number;
        failedRows: number;
        passThreshold: number;
        errorSummary: string | null;
        createdAt: string;
        updatedAt: string;
        createdByName: string | null;
      }>;
    }>('/api/cs-reply-quality/batches'),
  getCsReplyAgents: () => request<{ items: string[] }>('/api/cs-reply-quality/agents'),
  getCsReplyRecords: (params?: {
    page?: number;
    pageSize?: number;
    batchId?: string;
    agentName?: string;
    messageType?: string;
    scoreStatus?: string;
    minScore?: number;
    maxScore?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.batchId) q.set('batchId', params.batchId);
    if (params?.agentName) q.set('agentName', params.agentName);
    if (params?.messageType) q.set('messageType', params.messageType);
    if (params?.scoreStatus) q.set('scoreStatus', params.scoreStatus);
    if (params?.minScore !== undefined) q.set('minScore', String(params.minScore));
    if (params?.maxScore !== undefined) q.set('maxScore', String(params.maxScore));
    if (params?.keyword) q.set('keyword', params.keyword);
    const qs = q.toString();
    return request<{
      items: Array<CsReplyRecordSummary>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/cs-reply-quality/records${qs ? `?${qs}` : ''}`);
  },
  getCsReplyRecord: (id: string) => request<CsReplyRecordDetail>(`/api/cs-reply-quality/records/${id}`),
  previewCsReplyImport: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl('/api/cs-reply-quality/import/preview'), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<{
      totalRows: number;
      validRows: number;
      issueCount: number;
      issues: Array<{ row: number; field?: string; message: string }>;
      sample: Array<{
        rowNo: number;
        buyerEmail: string;
        sentAt: string | null;
        agentName: string;
        messageType: string;
        orderNo: string;
        buyerMessagePreview: string;
        agentReplyPreview: string;
      }>;
    }>;
  },
  importCsReplyFile: async (params: {
    file: File;
    name?: string;
    passThreshold?: number;
    autoScore?: boolean;
  }) => {
    const form = new FormData();
    form.append('file', params.file);
    if (params.name) form.append('name', params.name);
    if (params.passThreshold !== undefined) form.append('passThreshold', String(params.passThreshold));
    if (params.autoScore === false) form.append('autoScore', 'false');
    const res = await apiFetch(apiUrl('/api/cs-reply-quality/import'), { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) throw new Error(payload.message ?? 'Import failed');
    return payload as {
      id: string;
      batchNo: string;
      name: string | null;
      status: string;
      totalRows: number;
      passThreshold: number;
    };
  },
  scoreCsReplyBatch: (batchId: string, rescore = false) =>
    request(`/api/cs-reply-quality/batches/${batchId}/score`, {
      method: 'POST',
      body: JSON.stringify({ rescore }),
    }),
  rescoreCsReplyRecord: (recordId: string) =>
    request(`/api/cs-reply-quality/records/${recordId}/rescore`, { method: 'POST' }),
  clearCsReplyData: (params?: { batchId?: string }) =>
    request<{ ok: boolean; deletedBatches: number; deletedRecords: number }>(
      '/api/cs-reply-quality/clear',
      { method: 'POST', body: JSON.stringify(params ?? {}) },
    ),
  exportCsReplyRecords: async (params?: {
    batchId?: string;
    agentName?: string;
    messageType?: string;
    scoreStatus?: string;
    minScore?: number;
    maxScore?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.batchId) q.set('batchId', params.batchId);
    if (params?.agentName) q.set('agentName', params.agentName);
    if (params?.messageType) q.set('messageType', params.messageType);
    if (params?.scoreStatus) q.set('scoreStatus', params.scoreStatus);
    if (params?.minScore !== undefined) q.set('minScore', String(params.minScore));
    if (params?.maxScore !== undefined) q.set('maxScore', String(params.maxScore));
    if (params?.keyword) q.set('keyword', params.keyword);
    const qs = q.toString();
    const res = await apiFetch(apiUrl(`/api/cs-reply-quality/records/export${qs ? `?${qs}` : ''}`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cs-reply-scores-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  getRoles: () => request<Array<{ id: string; name: string; code: string; isSystem: boolean }>>('/api/roles'),
  createRole: (data: { name: string; code: string; description?: string }) =>
    request('/api/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateRole: (id: string, data: { name?: string; description?: string }) =>
    request(`/api/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRole: (id: string) => request(`/api/roles/${id}`, { method: 'DELETE' }),
  getRoleMenus: (roleId: string) => request<Array<{ menuId: string; menuCode: string }>>(`/api/roles/${roleId}/menus`),
  updateRoleMenus: (roleId: string, menuIds: string[]) =>
    request(`/api/roles/${roleId}/menus`, { method: 'PUT', body: JSON.stringify({ menuIds }) }),
  getSkus: () => request<Sku[]>('/api/skus'),
  createSku: (data: Partial<Sku> & { spuCode?: string }) =>
    request<Sku>('/api/skus', { method: 'POST', body: JSON.stringify(data) }),
  updateSku: (id: string, data: Partial<Sku>) =>
    request<Sku>(`/api/skus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getSpus: (params?: { q?: string; category?: string; brand?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{ items: Spu[]; total: number; page: number; pageSize: number }>(
      `/api/spus${query ? `?${query}` : ''}`,
    );
  },
  createSpu: (data: Partial<Spu>) => request<Spu>('/api/spus', { method: 'POST', body: JSON.stringify(data) }),
  updateSpu: (id: string, data: Partial<Spu>) =>
    request<Spu>(`/api/spus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getMerchantsMaster: (params?: { q?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{ items: Merchant[]; total: number; page: number; pageSize: number }>(
      `/api/merchants/master${query ? `?${query}` : ''}`,
    );
  },
  createMerchant: (data: Partial<Merchant>) =>
    request<Merchant>('/api/merchants', { method: 'POST', body: JSON.stringify(data) }),
  updateMerchant: (id: string, data: Partial<Merchant>) =>
    request<Merchant>(`/api/merchants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getSkuOverview: (params?: {
    q?: string;
    category?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.merchantCode) qs.set('merchantCode', params.merchantCode);
    if (params?.ownerName) qs.set('ownerName', params.ownerName);
    if (params?.developerName) qs.set('developerName', params.developerName);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{ items: SkuOverview[]; total: number; page: number; pageSize: number }>(
      `/api/products/sku-overview${query ? `?${query}` : ''}`,
    );
  },
  getDashboard: () =>
    request<{
      kpis: {
        openAlerts: number;
        pendingReorderSuggestions: number;
        draftPmcPlans: number;
        activePmcPlans: number;
        purchaseTrackingPending: number;
        activeSkus: number;
        salesQtyLast7Days: number;
        openAlertsLast7Days: number;
        latestInventoryDate?: string | null;
        latestSalesDate?: string | null;
      };
      dataFreshness?: {
        latestInventoryDate?: string | null;
        latestSalesDate?: string | null;
      };
      taskRuns?: {
        stockAlert: TaskRunSummary | null;
        replenishmentForecast: TaskRunSummary | null;
      };
      trends: {
        salesLast7Days: Array<{ date: string; qty: number }>;
        salesLast30Days: Array<{ date: string; qty: number }>;
      };
      todos: Array<{
        type: string;
        title: string;
        subtitle?: string;
        href: string;
        priority: 'high' | 'medium' | 'low';
      }>;
      loopFunnel?: {
        pendingReorderSuggestions: number;
        draftPmcPlans: number;
        activePmcPlans: number;
        trackingPendingConfirm: number;
        trackingInFulfillment: number;
        trackingInTransit: number;
        trackingException: number;
        trackingReceived: number;
      };
      forecastContext?: {
        versionId: string;
        versionNo: string;
        publishedAt?: string | null;
        highMapeSkuCount: number;
      } | null;
    }>('/api/dashboard'),
  getSalesHistory: (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    warehouse?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.category) qs.set('category', params.category);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        category?: string | null;
        saleDate: string;
        qtySold: number;
        channel?: string | null;
        warehouseCode?: string | null;
        source: string;
      }>;
      summary: { totalQty: number; rowCount: number };
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales/history${query ? `?${query}` : ''}`);
  },
  exportSalesHistoryCsv: async (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    warehouse?: string;
    category?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.category) qs.set('category', params.category);
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales/history/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-daily-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportSalesHistoryMonthlyCsv: async (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    category?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.category) qs.set('category', params.category);
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales/history/monthly/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-monthly-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  previewImport: (type: ImportType, body: { csv: string }) =>
    request<{
      rowCount: number;
      headers: string[];
      preview: Array<Record<string, string>>;
      validationIssues?: ImportValidationIssue[];
      hasBlockingIssues?: boolean;
    }>(`/api/import/${type}/preview`, { method: 'POST', body: JSON.stringify(body) }),
  previewImportFile: async (type: ImportType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/import/${type}/preview`), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<{
      rowCount: number;
      headers: string[];
      preview: Array<Record<string, string>>;
      validationIssues?: ImportValidationIssue[];
      hasBlockingIssues?: boolean;
      salesDiagnostics?: {
        daily: {
          expandedRowCount: number;
          skuCount: number;
          startDate: string | null;
          endDate: string | null;
        } | null;
      };
    }>;
  },
  previewSalesXiaoshouFiles: async (files: { dailyFile?: File | null }) => {
    if (!files.dailyFile) {
      throw new Error('请选择日销量 CSV（产品销售报表-每日宽表）');
    }
    const form = new FormData();
    form.append('dailyFile', files.dailyFile);
    const res = await apiFetch(apiUrl('/api/import/sales/preview'), { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json();
  },
  importSalesXiaoshouFiles: async (files: { dailyFile?: File | null }) => {
    if (!files.dailyFile) {
      throw new Error('请选择日销量 CSV（产品销售报表-每日宽表）');
    }
    const form = new FormData();
    form.append('dailyFile', files.dailyFile);
    const res = await apiFetch(apiUrl('/api/import/sales'), { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      throw new Error(payload.message ?? 'Import failed');
    }
    return payload as {
      imported: number;
      errors: string[];
      createdSkus?: number;
      enrichedSkus?: number;
      insertedDailyRows?: number;
      skippedDailyRows?: number;
      upsertedMonthlyRows?: number;
      batchId?: string;
      batchStatus?: string;
      async?: boolean;
      rowCount?: number;
      estimatedDailyRows?: number;
      message?: string;
      validationIssues?: ImportValidationIssue[];
    };
  },
  getBitableStatus: () =>
    request<Record<BitableSyncType, BitableSyncTargetStatus>>('/api/bitable/status'),
  previewBitableSync: (type: BitableSyncType) =>
    request<{
      rowCount: number;
      headers: string[];
      preview: Array<Record<string, string>>;
      validationIssues?: ImportValidationIssue[];
      hasBlockingIssues?: boolean;
      source: 'feishu-bitable';
    }>(`/api/bitable/sync/${type}/preview`, { method: 'POST' }),
  executeBitableSync: (type: BitableSyncType) =>
    request<{
      imported: number;
      errors: string[];
      batchId?: string;
      batchStatus?: string;
      validationIssues?: ImportValidationIssue[];
      source: 'feishu-bitable';
    }>(`/api/bitable/sync/${type}`, { method: 'POST' }),
  getImportBatches: (type?: ImportType) =>
    request<
      Array<{
        id: string;
        type: string;
        fileName?: string | null;
        rowCount: number;
        successCount: number;
        errorCount: number;
        status: string;
        errorSummary?: string | null;
        createdAt: string;
        dailyRowsWritten?: number;
        progressMeta?: {
          estimatedDailyRows?: number;
          processedSkuWideRows?: number;
          phase?: 'writing' | 'aggregating' | 'pruning';
        } | null;
      }>
    >(`/api/import/batches${type ? `?type=${type}` : ''}`),
  getSkuSuppliers: (skuId: string) =>
    request<
      Array<{
        id: string;
        merchantCode: string;
        merchantName: string;
        unitPrice?: string | null;
        leadTimeDays?: number | null;
        moq?: number | null;
        isDefault: boolean;
      }>
    >(`/api/skus/${skuId}/suppliers`),
  setDefaultSkuSupplier: (supplierId: string) =>
    request(`/api/sku-suppliers/${supplierId}/default`, { method: 'PUT' }),
  getInventoryOverview: (params?: {
    q?: string;
    category?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
    page?: number;
    pageSize?: number;
    view?: string;
    columns?: string[];
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.merchantCode) qs.set('merchantCode', params.merchantCode);
    if (params?.ownerName) qs.set('ownerName', params.ownerName);
    if (params?.developerName) qs.set('developerName', params.developerName);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.view) qs.set('view', params.view);
    if (params?.columns?.length) {
      qs.set('columns', params.columns.map((c) => encodeURIComponent(c)).join(','));
    }
    const query = qs.toString();
    return request<{
      items: InventoryOverview[];
      total: number;
      page: number;
      pageSize: number;
      columns?: Array<{
        id: string;
        label: string;
        group: string;
        kind: 'meta' | 'sheet' | 'ops';
        excelCol?: string;
        defaultVisible: boolean;
      }>;
      defaultVisibleColumns?: string[];
    }>(`/api/inventory/overview${query ? `?${query}` : ''}`);
  },
  getInventoryOverviewDetail: (skuId: string) =>
    request<InventoryOverview>(`/api/inventory/overview/${skuId}`),
  exportInventoryOverviewCsv: async (params?: {
    q?: string;
    category?: string;
    lifecycle?: string;
    salesCountry?: string;
    merchantCode?: string;
    ownerName?: string;
    developerName?: string;
    view?: string;
    columns?: string[];
    full?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.lifecycle) qs.set('lifecycle', params.lifecycle);
    if (params?.salesCountry) qs.set('salesCountry', params.salesCountry);
    if (params?.merchantCode) qs.set('merchantCode', params.merchantCode);
    if (params?.ownerName) qs.set('ownerName', params.ownerName);
    if (params?.developerName) qs.set('developerName', params.developerName);
    if (params?.view) qs.set('view', params.view);
    if (params?.full) qs.set('full', 'true');
    if (params?.columns?.length) {
      qs.set('columns', params.columns.map((c) => encodeURIComponent(c)).join(','));
    }
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/inventory/overview/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-turnover-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportInventoryCsv: async () => {
    const res = await apiFetch(apiUrl('/api/inventory/export'));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  createInventoryRecord: (data: {
    skuId: string;
    warehouse: string;
    qtyAvailable?: number;
    qtyInTransit?: number;
    qtyInProduction?: number;
    recordedDate: string;
  }) => request('/api/inventory/records', { method: 'POST', body: JSON.stringify(data) }),
  getMerchants: () =>
    request<Array<{ merchantCode: string; merchantName?: string | null }>>('/api/merchants'),
  getWarehouses: () =>
    request<
      Array<{
        id: string;
        code: string;
        name: string;
        regionGroup: string;
        countryCode?: string | null;
        allowCrossFulfill: boolean;
      }>
    >('/api/warehouses'),
  getChannelWarehousePrefs: () =>
    request<
      Array<{
        channel: string;
        primaryWarehouseCode: string;
        overflowWarehouseCodes?: string | null;
        lastMileCostIndex: string;
      }>
    >('/api/channel-warehouse-prefs'),
  getSafetyStock: () =>
    request<
      Array<{
        id: string | null;
        skuId: string;
        skuCode: string;
        skuName: string;
        warehouseCode: string;
        safetyStockQty: number | null;
        reorderPoint: number | null;
        reorderQty: number | null;
        calcMethod: string | null;
      }>
    >('/api/safety-stock'),
  updateSafetyStock: (
    skuId: string,
    data: { safetyStockQty: number; reorderPoint: number; reorderQty: number },
    warehouseCode?: string,
  ) => {
    const qs = warehouseCode ? `?warehouse=${encodeURIComponent(warehouseCode)}` : '';
    return request(`/api/safety-stock/${skuId}${qs}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  calculateSafetyStock: (skuId: string, warehouseCode?: string) => {
    const qs = warehouseCode ? `?warehouse=${encodeURIComponent(warehouseCode)}` : '';
    return request(`/api/safety-stock/${skuId}/calculate${qs}`, { method: 'POST' });
  },
  getAlerts: () =>
    request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        warehouseCode?: string | null;
        alertType: string;
        currentQty: number;
        safetyQty: number;
        isResolved: boolean;
      }>;
      summary: string;
      openCount: number;
    }>('/api/alerts'),
  resolveAlert: (id: string) => request(`/api/alerts/${id}/resolve`, { method: 'PATCH' }),
  getReorderSuggestions: () =>
    request<
      Array<{
        id: string;
        skuCode: string;
        skuName: string;
        merchantCode?: string | null;
        merchantName?: string | null;
        warehouseCode?: string | null;
        suggestedQty: number;
        suggestedDate: string;
        reason: string;
        healthStatus?: InventoryHealth | null;
        coverageDays?: string | null;
        totalLeadDays?: number | null;
        latestOrderDays?: string | null;
        metrics?: Record<string, unknown> | null;
        status: string;
        planId?: string | null;
      }>
    >('/api/reorder/suggestions'),
  updateReorderSuggestion: (id: string, data: { status: 'accepted' | 'ignored'; merchantCode?: string }) =>
    request(`/api/reorder/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getPurchaseTracking: (status?: PurchaseDraftStatus) =>
    request<
      Array<{
        id: string;
        draftNo: string;
        skuCode: string;
        skuName: string;
        qty: number;
        receivedQty: number;
        remainingQty: number;
        expectedDate?: string | null;
        confirmedDeliveryDate?: string | null;
        actualShipDate?: string | null;
        actualReceivedDate?: string | null;
        source: string;
        planId?: string | null;
        planItemId?: string | null;
        planNo?: string | null;
        merchantCode?: string | null;
        merchantName?: string | null;
        status: PurchaseDraftStatus;
        statusLabel: string;
        exceptionReason?: string | null;
        remark?: string | null;
      }>
    >(`/api/purchase-drafts${status ? `?status=${status}` : ''}`),
  updatePurchaseTracking: (
    id: string,
    data: {
      status?: PurchaseDraftStatus;
      remark?: string;
      confirmedDeliveryDate?: string;
      actualShipDate?: string;
      exceptionReason?: string;
    },
  ) => request(`/api/purchase-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  receivePurchaseTracking: (
    id: string,
    data: { qtyReceived: number; receivedDate?: string; idempotencyKey?: string },
  ) =>
    request(`/api/purchase-drafts/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getProcurementListConfig: () =>
    request<Record<ProcurementListType, ProcurementListConfig>>('/api/procurement/lists/config'),
  getProcurementListMeta: (type: ProcurementListType) =>
    request<ProcurementListMeta>(`/api/procurement/lists/${type}/meta`),
  listProcurementRows: (params: {
    type: ProcurementListType;
    page?: number;
    pageSize?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.keyword) q.set('keyword', params.keyword);
    const suffix = q.toString() ? `?${q}` : '';
    return request<{
      items: ProcurementListRow[];
      total: number;
      page: number;
      pageSize: number;
      columns: string[];
      meta: ProcurementListMeta;
    }>(`/api/procurement/lists/${params.type}${suffix}`);
  },
  previewProcurementFeishuSync: (type: ProcurementListType) =>
    request<{
      source: 'feishu';
      totalRows: number;
      columnOrder: string[];
      sample: Array<Record<string, string>>;
    }>(`/api/procurement/lists/${type}/sync/preview`, { method: 'POST' }),
  executeProcurementFeishuSync: (type: ProcurementListType) =>
    request<{
      imported: number;
      columnOrder: string[];
      source: 'feishu';
    }>(`/api/procurement/lists/${type}/sync`, { method: 'POST' }),
  previewProcurementFeishuPush: (type: ProcurementListType) =>
    request<{
      direction: 'to_feishu';
      localRowCount: number;
      feishuRowCount: number;
      toUpdate: number;
      toCreate: number;
      toDelete: number;
      columnOrder: string[];
      sample: Array<Record<string, string>>;
    }>(`/api/procurement/lists/${type}/push/preview`, { method: 'POST' }),
  executeProcurementFeishuPush: (type: ProcurementListType) =>
    request<{
      direction: 'to_feishu';
      pushed: number;
      updated: number;
      created: number;
      deleted: number;
    }>(`/api/procurement/lists/${type}/push`, { method: 'POST' }),
  previewProcurementUpload: async (type: ProcurementListType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/procurement/lists/${type}/import/preview`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Preview failed');
    }
    return res.json() as Promise<{
      source: 'upload';
      totalRows: number;
      columnOrder: string[];
      sample: Array<Record<string, string>>;
    }>;
  },
  executeProcurementUpload: async (type: ProcurementListType, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/procurement/lists/${type}/import`), {
      method: 'POST',
      body: form,
    });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      throw new Error(payload.message ?? 'Import failed');
    }
    return payload as {
      imported: number;
      columnOrder: string[];
      source: 'upload';
    };
  },
  getPmcPlans: () =>
    request<
      Array<{
        id: string;
        planNo: string;
        name: string;
        merchantCode: string;
        merchantName?: string | null;
        targetWarehouseCode?: string | null;
        planDate: string;
        deliveryDate: string;
        status: string;
      }>
    >('/api/pmc/plans'),
  getPmcPlan: (id: string) =>
    request<{
      id: string;
      planNo: string;
      name: string;
      merchantCode: string;
      merchantName?: string | null;
      targetWarehouseCode?: string | null;
      planDate: string;
      deliveryDate: string;
      status: string;
      items: Array<{
        id: string;
        skuCode: string;
        skuName: string;
        warehouseCode?: string | null;
        plannedQty: number;
        completedQty: number | null;
        unit: string;
      }>;
      purchaseTracking?: Array<{
        id: string;
        draftNo: string;
        skuCode: string;
        qty: number;
        receivedQty: number;
        status: string;
        planItemId?: string | null;
        confirmedDeliveryDate?: string | null;
        exceptionReason?: string | null;
      }>;
    }>(`/api/pmc/plans/${id}`),
  exportPmcPlan: async (id: string, planNo?: string, format: 'csv' | 'xlsx' = 'csv') => {
    const qs = format === 'xlsx' ? '?format=xlsx' : '';
    const res = await apiFetch(apiUrl(`/api/pmc/plans/${id}/export${qs}`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${planNo ?? id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  },
  exportPmcPlanCsv: async (id: string, planNo?: string) => {
    const res = await apiFetch(apiUrl(`/api/pmc/plans/${id}/export`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Export failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${planNo ?? id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  createPmcPlan: (data: {
    name: string;
    merchantCode: string;
    merchantName?: string;
    targetWarehouseCode: string;
    planDate: string;
    deliveryDate: string;
    remark?: string;
    items: Array<{ skuId: string; plannedQty: number; unit?: string; warehouseCode?: string }>;
  }) => request('/api/pmc/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePmcPlanStatus: (id: string, status: string) =>
    request(`/api/pmc/plans/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updatePmcPlanItem: (planId: string, itemId: string, data: { completedQty?: number; plannedQty?: number }) =>
    request(`/api/pmc/plans/${planId}/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
  receivePmcPlanItem: (
    planId: string,
    itemId: string,
    data: { qtyReceived: number; receivedDate?: string; idempotencyKey?: string },
  ) =>
    request(`/api/pmc/plans/${planId}/items/${itemId}/receive`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importData: (
    type: ImportType,
    body: { csv: string; planName?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
  ) =>
    request<{
      imported: number;
      errors: string[];
      createdSkus?: number;
      updatedSkus?: number;
      batchId?: string;
      batchStatus?: string;
      validationIssues?: ImportValidationIssue[];
    }>(`/api/import/${type}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importFile: async (
    type: ImportType,
    file: File,
    meta?: { planName?: string; planDate?: string; deliveryDate?: string; merchantCode?: string; merchantName?: string },
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (meta?.planName) form.append('planName', meta.planName);
    if (meta?.planDate) form.append('planDate', meta.planDate);
    if (meta?.deliveryDate) form.append('deliveryDate', meta.deliveryDate);
    if (meta?.merchantCode) form.append('merchantCode', meta.merchantCode);
    if (meta?.merchantName) form.append('merchantName', meta.merchantName);
    const res = await apiFetch(apiUrl(`/api/import/${type}`), { method: 'POST', body: form });
    const payload = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      throw new Error(payload.message ?? 'Import failed');
    }
    return payload as {
      imported: number;
      errors: string[];
      createdSkus?: number;
      updatedSkus?: number;
      batchId?: string;
      batchStatus?: string;
      async?: boolean;
      rowCount?: number;
      message?: string;
      validationIssues?: ImportValidationIssue[];
    };
  },
  importInventoryCsv: (csv: string) =>
    request<{ imported: number; errors: string[] }>('/api/import/inventory', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  runStockAlert: () => request('/api/tasks/stock-alert', { method: 'POST' }),
  runReplenishmentForecast: () => request('/api/tasks/replenishment-forecast', { method: 'POST' }),
  getAiConfig: () =>
    request<{
      mode: 'local' | 'dify';
      difyEnabled: boolean;
      replenishmentWorkflow?: boolean;
      alertWorkflow?: boolean;
      salesForecastWorkflow?: boolean;
    }>('/api/ai/config'),
  getAiConversations: () =>
    request<Array<{ id: string; title: string | null; createdAt: string }>>('/api/ai/conversations'),
  getAiMessages: (conversationId: string) =>
    request<{
      conversation: { id: string; title: string | null };
      messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        sources?: Array<{ document_name?: string; content?: string }> | null;
        createdAt: string;
      }>;
    }>(`/api/ai/conversations/${conversationId}/messages`),
  chat: (body: {
    query: string;
    conversationId?: string;
    skuCode?: string;
    skuId?: string;
    warehouseCode?: string;
  }) =>
    request<{
      answer: string;
      conversationId: string;
      sources?: Array<{ document_name?: string; content?: string }>;
      mode?: 'local' | 'dify' | 'local-fallback';
      mock?: boolean;
      fallback?: boolean;
    }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getFobFeeRules: (params?: { sourceBillType?: 'trucking' | 'freight' }) => {
    const q = params?.sourceBillType ? `?sourceBillType=${params.sourceBillType}` : '';
    return request<
      Array<{
        id: string;
        feeType: string | null;
        sourceBillType: string;
        matchPattern: string | null;
        allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
        defaultStage: string;
        priority: number;
        isActive: boolean;
        remark: string | null;
        createdAt: string;
      }>
    >(`/api/logistics/fob-fee-rules${q}`);
  },
  createFobFeeRule: (data: {
    feeType?: string;
    matchPattern?: string;
    sourceBillType: 'trucking' | 'freight';
    allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
    defaultStage?: 'trucking' | 'freight' | 'customs' | 'other';
    priority?: number;
    remark?: string;
    isActive?: boolean;
  }) =>
    request('/api/logistics/fob-fee-rules', { method: 'POST', body: JSON.stringify(data) }),
  resetFobFeeRulePriorities: () =>
    request<{ ok: boolean; updated: number }>('/api/logistics/fob-fee-rules/reset-priorities', {
      method: 'POST',
    }),
  updateFobFeeRule: (
    id: string,
    data: {
      feeType?: string | null;
      matchPattern?: string | null;
      allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
      defaultStage?: 'trucking' | 'freight' | 'customs' | 'other';
      priority?: number;
      remark?: string | null;
      isActive?: boolean;
    },
  ) =>
    request(`/api/logistics/fob-fee-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getFobServiceProviders: (params?: { providerType?: 'trucking' | 'freight'; activeOnly?: boolean }) => {
    const search = new URLSearchParams();
    if (params?.providerType) search.set('providerType', params.providerType);
    if (params?.activeOnly) search.set('activeOnly', 'true');
    const q = search.toString() ? `?${search.toString()}` : '';
    return request<
      Array<{
        id: string;
        code: string;
        name: string;
        providerType: 'trucking' | 'freight';
        sortOrder: number;
        isActive: boolean;
        remark: string | null;
        createdAt: string;
        updatedAt: string;
      }>
    >(`/api/logistics/fob-service-providers${q}`);
  },
  createFobServiceProvider: (data: {
    code: string;
    name: string;
    providerType: 'trucking' | 'freight';
    sortOrder?: number;
    remark?: string;
    isActive?: boolean;
  }) =>
    request('/api/logistics/fob-service-providers', { method: 'POST', body: JSON.stringify(data) }),
  updateFobServiceProvider: (
    id: string,
    data: {
      name?: string;
      providerType?: 'trucking' | 'freight';
      sortOrder?: number;
      remark?: string | null;
      isActive?: boolean;
    },
  ) =>
    request(`/api/logistics/fob-service-providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  toggleFobServiceProvider: (id: string) =>
    request(`/api/logistics/fob-service-providers/${id}/toggle`, { method: 'PATCH' }),
  getFobSettlements: () =>
    request<
      Array<{
        id: string;
        batchNo: string;
        name: string;
        settlementPeriod: string;
        settlementType: 'trucking' | 'freight';
        serviceProviderId: string;
        usdToCnyRate: string;
        status: string;
        createdBy?: string | null;
        createdByName?: string | null;
        createdAt: string;
        serviceProvider: {
          id: string;
          code: string;
          name: string;
          providerType: 'trucking' | 'freight';
        } | null;
      }>
    >('/api/logistics/fob-settlements'),
  getFobSettlement: (id: string) =>
    request<{
      id: string;
      batchNo: string;
      name: string;
      settlementPeriod: string;
      settlementType: 'trucking' | 'freight';
      serviceProviderId: string;
      usdToCnyRate: string;
      status: string;
      createdBy?: string | null;
      createdByName?: string | null;
      createdAt: string;
      serviceProvider: {
        id: string;
        code: string;
        name: string;
        providerType: 'trucking' | 'freight';
      } | null;
      merchantShipments: Array<Record<string, unknown>>;
      containerStats: Array<{
        id: string;
        containerNo: string;
        merchantCode: string;
        merchantName?: string | null;
        volumeCbm: string;
        ticketCount: number;
        businessNos: string;
        factoryType: string;
        skuCodes: string;
      }>;
      truckingItems: Array<Record<string, unknown>>;
      freightItems: Array<Record<string, unknown>>;
      pendingExceptions: number;
      allocations: Array<{
        id: string;
        containerNo: string;
        merchantCode: string;
        stage: string;
        feeType: string;
        sourceBillItemId?: string | null;
        allocationMethod: string;
        sourceAmountCny?: string;
        volumeRatio: string;
        ticketRatio?: string | null;
        allocatedAmountCny: string;
        isManualOverride?: boolean;
        overrideReason?: string | null;
      }>;
      merchantSummary: Array<{
        merchantCode: string;
        merchantName?: string | null;
        truckingTotal: number;
        freightTotal: number;
        customsTotal: number;
        otherTotal: number;
        grandTotal: number;
        paymentStatus: 'paid' | 'unpaid' | 'not_required';
        paymentRemark: string | null;
      }>;
      nonFobContainers?: string[];
      containerMatch?: {
        volumeCount: number;
        billCount: number;
        matchedCount: number;
        matched: string[];
        volumeOnly: string[];
        billOnly: string[];
        nonFobOnly: string[];
        canAllocate: boolean;
      };
    }>(`/api/logistics/fob-settlements/${id}`),
  createFobSettlement: (data: {
    name: string;
    settlementPeriod: string;
    settlementType: 'trucking' | 'freight';
    serviceProviderId: string;
    usdToCnyRate?: number;
    remark?: string;
  }) =>
    request('/api/logistics/fob-settlements', { method: 'POST', body: JSON.stringify(data) }),
  updateFobSettlement: (
    id: string,
    data: { name?: string; usdToCnyRate?: number; status?: string; remark?: string },
  ) =>
    request(`/api/logistics/fob-settlements/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFobSettlement: (id: string) =>
    request<{ ok: boolean }>(`/api/logistics/fob-settlements/${id}`, { method: 'DELETE' }),
  patchFobMerchantPayments: (
    id: string,
    data: {
      updates: Array<{
        merchantCode: string;
        paymentStatus: 'paid' | 'unpaid' | 'not_required';
        remark?: string;
      }>;
    },
  ) =>
    request<{ ok: boolean; updated: number }>(
      `/api/logistics/fob-settlements/${id}/merchant-payments`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),
  downloadFobTemplate: async (type: 'volume' | 'trucking' | 'freight') => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/templates/${type}`));
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Download failed');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = match ? decodeURIComponent(match[1]) : `fob-${type}-template.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  importFobTrucking: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/import/trucking`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      containers: number;
      skippedRows: number;
      errors: string[];
      warnings?: string[];
    }>;
  },
  importFobFreight: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/import/freight`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      containers: number;
      skippedRows: number;
      errors: string[];
      warnings?: string[];
    }>;
  },
  importFobShipments: async (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/import/shipments`), {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      containers: number;
      merchants: number;
      skippedRows: number;
      errors: string[];
    }>;
  },
  getFobExceptions: (id: string) =>
    request<{
      items: Array<{
        id: string;
        billType: 'trucking' | 'freight';
        containerNo: string;
        feeType: string;
        amountCny: number;
        adjustedAmountCny: number;
        allocationMethod: string | null;
        assignedMerchantCode: string | null;
        exceptionStatus: string | null;
        exceptionReason?: 'unconfigured' | 'remark' | 'amount' | 'fee_name';
        exceptionReasonLabel?: string;
        reviewNote: string | null;
        remark: string | null;
      }>;
      pendingCount: number;
    }>(`/api/logistics/fob-settlements/${id}/exceptions`),
  patchFobException: (
    id: string,
    itemId: string,
    data: {
      billType: 'trucking' | 'freight';
      exceptionStatus?: 'pending' | 'confirmed' | 'rejected';
      assignedMerchantCode?: string;
      adjustedAmountCny?: number;
      allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
      reviewNote?: string;
    },
  ) =>
    request(`/api/logistics/fob-settlements/${id}/exceptions/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getFobReconcile: (id: string) =>
    request<{
      billTotalCny: number;
      allocationTotalCny: number;
      diffCny: number;
      balanced: boolean;
      pendingExceptions: number;
      warnings: string[];
      containerChecks: Array<{
        containerNo: string;
        feeType: string;
        sourceBillType: 'trucking' | 'freight';
        sourceBillItemId: string;
        sourceAmountCny: number;
        allocatedCny: number;
        diffCny: number;
      }>;
    }>(`/api/logistics/fob-settlements/${id}/reconcile`),
  postFobAdjustment: (
    id: string,
    data: {
      allocationId: string;
      adjustType: 'amount' | 'merchant' | 'exclude';
      adjustedValue: string;
      reason?: string;
    },
  ) =>
    request(`/api/logistics/fob-settlements/${id}/adjustments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  calculateFobSettlement: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/calculate`), {
      method: 'POST',
    });
    const body = await res.json().catch(() => ({ message: res.statusText }));
    if (!res.ok) {
      const err = new Error(body.message ?? '核算失败') as Error & {
        warnings?: string[];
        containerMatch?: {
          volumeCount: number;
          billCount: number;
          matchedCount: number;
          matched: string[];
          volumeOnly: string[];
          billOnly: string[];
          nonFobOnly: string[];
          canAllocate: boolean;
        };
      };
      err.warnings = body.warnings;
      err.containerMatch = body.containerMatch;
      throw err;
    }
    return body as {
      allocationCount: number;
      warnings: string[];
      reconcile: {
        billTotalCny: number;
        allocationTotalCny: number;
        diffCny: number;
        balanced: boolean;
      };
      merchantSummary: Array<{
        merchantCode: string;
        grandTotal: number;
        paymentStatus?: 'paid' | 'unpaid' | 'not_required';
        paymentRemark?: string | null;
      }>;
    };
  },
  downloadFobReconcileTotal: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/export/reconcile-total`));
    await downloadAttachment(res, '分摊总账.xlsx');
  },
  downloadFobReconcileByMerchant: async (id: string) => {
    const res = await apiFetch(apiUrl(`/api/logistics/fob-settlements/${id}/export/reconcile-by-merchant`));
    await downloadAttachment(res, '按工厂主体导出.zip');
  },
  getSalesPlatforms: (station?: string) => {
    const qs = station ? `?station=${encodeURIComponent(station)}` : '';
    return request<Array<{ code: string; name: string; station?: string | null }>>(
      `/api/sales-platforms${qs}`,
    );
  },
  getSalesHistoryCategories: () => request<string[]>('/api/sales/categories'),
  getSalesImportPolicy: () =>
    request<{
      mode: 'full_init' | 'incremental';
      importMinSaleDate: string | null;
      recommendedIncrementalDate: string;
      dailyRetentionDays: number;
      isProduction: boolean;
    }>('/api/sales/import-policy'),
  searchSalesHistoryCategories: (q?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (q?.trim()) qs.set('q', q.trim());
    if (limit) qs.set('limit', String(limit));
    const query = qs.toString();
    return request<string[]>(`/api/sales/categories${query ? `?${query}` : ''}`);
  },
  getSalesHistoryMonthly: (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.category) qs.set('category', params.category);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        category?: string | null;
        saleYear: number;
        month: number;
        saleMonth: string;
        qtySold: number;
        channel: string;
        source: string;
      }>;
      summary: { totalQty: number; rowCount: number };
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales/history/monthly${query ? `?${query}` : ''}`);
  },
  getSalesForecastStations: () => request<string[]>('/api/sales-forecast/stations'),
  getSalesForecastCategories: (q?: string, limit = 50) => {
    const qs = new URLSearchParams();
    if (q?.trim()) qs.set('q', q.trim());
    if (limit) qs.set('limit', String(limit));
    const query = qs.toString();
    return request<string[]>(`/api/sales-forecast/categories${query ? `?${query}` : ''}`);
  },
  generateSalesForecastBaseline: async (body: {
    station?: string;
    platform?: string;
    category?: string;
    skuCode?: string;
    versionName?: string;
    targetVersionId?: string;
    monthCount?: number;
    background?: boolean;
  }) => {
    const url = apiUrl('/api/sales-forecasts/generate-baseline');
    const res = await apiFetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = res.statusText;
      try {
        const err = JSON.parse(text) as { message?: string };
        message = err.message ?? message;
      } catch {
        if (text) message = text.slice(0, 200);
      }
      throw new Error(message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { ...data, async: res.status === 202 } as
      | {
          async: true;
          taskRunId: string;
          status: 'running';
          activeSkuCount: number;
          monthCount: number;
          estimatedForecastRows: number;
          maxForecastRows: number;
          platformCount?: number;
        }
      | {
          async: false;
          version: {
            id: string;
            versionNo: string;
            versionName: string;
            station?: string | null;
            status: string;
          };
          forecastRows: number;
          reviewRows: number;
          platformsGenerated?: string[];
          eligibilityStats?: {
            eligible: number;
            skipped: number;
            byTier: { core: number; mid: number; tail: number };
          };
        };
  },
  getSalesForecastBaselineTask: (taskRunId: string) =>
    request<{
      taskRunId: string;
      status: 'running' | 'success' | 'failed';
      startedAt: string;
      finishedAt: string | null;
      errorMessage: string | null;
      result: {
        version: {
          id: string;
          versionNo: string;
          versionName: string;
          station?: string | null;
          status: string;
        };
        forecastRows: number;
        reviewRows: number;
        platformsGenerated?: string[];
        eligibilityStats?: {
          eligible: number;
          skipped: number;
          byTier: { core: number; mid: number; tail: number };
        };
      } | null;
    }>(`/api/sales-forecasts/generate-baseline/tasks/${encodeURIComponent(taskRunId)}`),
  runDifySingleSkuForecast: (body: {
    skuCode: string;
    station: string;
    platform?: string;
    versionId?: string;
    monthCount?: number;
    assistMode?: 'auto' | 'human';
    exogenousFactors?: {
      factors: Array<{
        monthLabel: string;
        reason: 'price_change' | 'ad' | 'promo' | 'listing_change' | 'other';
        intensity?: number;
        note?: string;
      }>;
      operatorNote?: string;
    };
  }) =>
    request<{
      skuCode: string;
      skuName: string;
      tier: string;
      difyEnabled: boolean;
      rationale: string;
      monthlyForecasts: Array<{
        monthLabel: string;
        forecastYear: number;
        month: number;
        forecastDailyAvg: number;
        confidence?: string;
        rationale?: string;
      }>;
      writtenRows: number;
      missingMonths?: string[];
      versionId: string;
    }>('/api/sales-forecasts/dify/single', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastReviewItems: (params?: {
    versionId?: string;
    status?: 'pending' | 'reviewed' | 'ignored';
    severity?: 'critical' | 'warning' | 'info';
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.status) qs.set('status', params.status);
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      groupBy: 'sku_platform';
      items: ForecastReviewItemGroup[];
      total: number;
      page: number;
      pageSize: number;
      versionSummary: ForecastVersionSummary | null;
      contexts: Record<string, SkuForecastContext>;
      monthlyForecasts: Record<string, SkuMonthlyForecastCell[]>;
    }>(
      `/api/sales-forecasts/review-items${query ? `?${query}` : ''}`,
    );
  },
  batchUpdateSalesForecastReviewItems: (body: {
    ids: string[];
    status: 'pending' | 'reviewed' | 'ignored';
  }) =>
    request<{ updated: number }>('/api/sales-forecasts/review-items/batch-status', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateSalesForecastReviewItem: (
    id: string,
    body: { status?: 'pending' | 'reviewed' | 'ignored' },
  ) =>
    request<ForecastReviewItem>(`/api/sales-forecasts/review-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getSalesForecastReviewStats: (versionId?: string) => {
    const qs = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
    return request<{
      totalRecords: number;
      total: number;
      pending: number;
      pendingSkuCount: number;
      reviewed: number;
      ignored: number;
      pendingBySeverity: { critical: number; warning: number; info: number };
    }>(`/api/sales-forecasts/review-items/stats${qs}`);
  },
  getSalesForecastVersionSummary: (versionId: string) =>
    request<ForecastVersionSummary>(
      `/api/sales-forecasts/version-summary?versionId=${encodeURIComponent(versionId)}`,
    ),
  getSalesForecastSkuDetail: (params: {
    versionId: string;
    skuId?: string;
    skuCode?: string;
    station: string;
    platform: string;
  }) => {
    const qs = new URLSearchParams({
      versionId: params.versionId,
      station: params.station,
      platform: params.platform,
    });
    if (params.skuId) qs.set('skuId', params.skuId);
    if (params.skuCode) qs.set('skuCode', params.skuCode);
    return request<{
      versionSummary: ForecastVersionSummary;
      context: SkuForecastContext | null;
      reviewItems: ForecastReviewItem[];
      sku: {
        id: string;
        code: string;
        name: string;
        category: string | null;
        productCategory: string | null;
        lifecycle: string | null;
        salesCountry: string | null;
        ownerName: string | null;
        developerName: string | null;
        merchantCode: string | null;
        merchantName: string | null;
        specAttrs: Record<string, string> | null;
        unit: string;
        leadTimeDays: number | null;
        moq: number | null;
      };
    }>(`/api/sales-forecasts/sku-detail?${qs}`);
  },
  clearSalesForecastReviewItems: (body: {
    versionId?: string;
    scope: 'all' | 'version' | 'completed';
    confirmAll?: boolean;
  }) =>
    request<{ deleted: number }>('/api/sales-forecasts/review-items/clear', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  batchSalesForecastReviewItems: (body: {
    versionId: string;
    action: 'accept_suggested' | 'ignore_info' | 'ignore_all_pending';
  }) =>
    request<{ updated: number; skipped: number }>('/api/sales-forecasts/review-items/batch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastTrends: (params?: {
    dimensionType?: 'category' | 'project_group';
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.dimensionType) qs.set('dimensionType', params.dimensionType);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        dimensionType: 'category' | 'project_group';
        dimensionValue: string;
        month: number;
        seasonalityFactor: number;
        trendFactor: number | null;
        sourceBatchId?: string | null;
        updatedAt: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales-forecasts/trends${query ? `?${query}` : ''}`);
  },
  rebuildSalesForecastTrends: () =>
    request<{ factorCount: number; sourceMonthCount: number }>('/api/sales-forecasts/trends/rebuild', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getSalesForecastTrendsHorizon: (params?: {
    dimensionType?: 'category' | 'project_group';
    search?: string;
    page?: number;
    pageSize?: number;
    monthCount?: number;
    historyMonthCount?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.dimensionType) qs.set('dimensionType', params.dimensionType);
    if (params?.search) qs.set('search', params.search);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.monthCount) qs.set('monthCount', String(params.monthCount));
    if (params?.historyMonthCount != null) qs.set('historyMonthCount', String(params.historyMonthCount));
    const query = qs.toString();
    type HorizonCell = {
      forecastYear: number;
      month: number;
      monthLabel: string;
      calendarMonth: number;
      seasonalityFactor: number;
      trendFactor: number;
      combinedFactor: number;
      wasClipped: boolean;
    };
    return request<{
      horizon: Array<{
        forecastYear: number;
        month: number;
        monthLabel: string;
        calendarMonth: number;
      }>;
      historyHorizon: Array<{
        forecastYear: number;
        month: number;
        monthLabel: string;
        calendarMonth: number;
      }>;
      items: Array<{
        dimensionType: 'category' | 'project_group';
        dimensionValue: string;
        months: HorizonCell[];
        historyMonths: HorizonCell[];
      }>;
      total: number;
      page: number;
      pageSize: number;
      sourceBatch: {
        id: string;
        batchNo: string;
        monthlyStartMonth: string | null;
        monthlyEndMonth: string | null;
        skuCount: number | null;
        rowCount: number | null;
        createdAt: string;
      } | null;
    }>(`/api/sales-forecasts/trends/horizon${query ? `?${query}` : ''}`);
  },
  getSalesForecastHorizon: (params?: {
    versionId?: string;
    station?: string;
    platform?: string;
    skuId?: string;
    skuCode?: string;
    category?: string;
    profileSegment?: string;
    pendingCalibration?: boolean;
    page?: number;
    pageSize?: number;
    monthCount?: number;
    historyMonthCount?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.station) qs.set('station', params.station);
    if (params?.platform != null && params.platform !== '') qs.set('platform', params.platform);
    if (params?.skuId) qs.set('skuId', params.skuId);
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.category) qs.set('category', params.category);
    if (params?.profileSegment) qs.set('profileSegment', params.profileSegment);
    if (params?.pendingCalibration) qs.set('pendingCalibration', 'true');
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.monthCount != null) qs.set('monthCount', String(params.monthCount));
    if (params?.historyMonthCount != null) qs.set('historyMonthCount', String(params.historyMonthCount));
    const query = qs.toString();
    return request<{
      horizon: Array<{ forecastYear: number; month: number; monthLabel: string }>;
      historyHorizon: Array<{ forecastYear: number; month: number; monthLabel: string }>;
      items: Array<{
        skuId: string;
        skuCode: string;
        skuName: string;
        category: string | null;
        station: string;
        platform: string;
        lifecycle: string | null;
        forecastProfileClass?: string | null;
        profileSegment?: string | null;
        historyMonths: Array<{
          forecastYear: number;
          month: number;
          monthLabel: string;
          qtySold: number;
          actualDailyAvg: number;
        }>;
        months: Array<{
          id: string;
          forecastYear: number;
          month: number;
          monthLabel: string;
          forecastDailyAvg: number;
          manualDailyAvg: number | null;
          effectiveDailyAvg: number;
          adjustReason: string | null;
          baselineDailyAvg: number | null;
          lifecycle: string | null;
          confidenceLevel: string | null;
          skuTrendFactor: number | null;
          seasonalityFactor: number;
          trendFactor: number;
          categoryCombinedFactor: number;
          categoryTrendWasClipped: boolean;
          categoryTrendMatched: boolean;
          horizonFactors: {
            nearLevel: number;
            structuralLevel: number;
            yoyMonthLevel: number;
            yoyAnchorLevel: number;
            growthFactor: number;
            wNear: number;
            wYoy: number;
            horizonMonthIndex: number;
          } | null;
        }>;
      }>;
      total: number;
      page: number;
      pageSize: number;
      version: {
        id: string;
        versionName: string;
        status: string;
        station: string | null;
      } | null;
    }>(`/api/sales-forecasts/horizon${query ? `?${query}` : ''}`);
  },
  resetAllSalesForecastData: () =>
    request<{
      deleted: {
        forecastMonthly: number;
        forecastAccuracy: number;
        reviewItems: number;
        seasonality: number;
        sourceBatches: number;
        versions: number;
      };
    }>('/api/sales-forecasts/reset-all', {
      method: 'POST',
      body: JSON.stringify({ confirmAll: true }),
    }),
  getSalesForecastVersions: (params?: {
    status?: 'draft' | 'published' | 'archived';
    includeStats?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.includeStats) qs.set('includeStats', '1');
    const query = qs.toString();
    if (params?.includeStats) {
      return request<ForecastVersionListItem[]>(
        `/api/sales-forecast-versions${query ? `?${query}` : ''}`,
      );
    }
    return request<ForecastVersionBasic[]>(
      `/api/sales-forecast-versions${query ? `?${query}` : ''}`,
    );
  },
  getSalesForecastVersion: (id: string) =>
    request<ForecastVersionListItem>(`/api/sales-forecast-versions/${id}`),
  createSalesForecastVersion: (body?: { versionName?: string; station?: string }) =>
    request<{
      id: string;
      versionNo: string;
      versionName: string;
      status: string;
    }>('/api/sales-forecast-versions', { method: 'POST', body: JSON.stringify(body ?? {}) }),
  validateSalesForecastVersion: (id: string) =>
    request<{
      issues: Array<{
        level: 'error' | 'warning' | 'info';
        code: string;
        message: string;
        skuCode?: string;
        forecastMonth?: string;
      }>;
      canPublish: boolean;
      rowCount: number;
    }>(`/api/sales-forecast-versions/${id}/validate`),
  publishSalesForecastVersion: async (id: string) => {
    const url = apiUrl(`/api/sales-forecast-versions/${id}/publish`);
    let res: Response;
    try {
      res = await apiFetch(url, { method: 'POST' });
    } catch (err) {
      const hint =
        typeof window !== 'undefined' && window.location.hostname === 'localhost'
          ? '（Windows Docker 请改用 http://127.0.0.1:8081 访问，localhost 可能走 IPv6 导致请求失败）'
          : '';
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${msg}${hint}`);
    }
    if (!res.ok) {
      const text = await res.text();
      type PublishError = {
        message?: string;
        issues?: Array<{ level: string; code: string; message: string }>;
      };
      let payload: PublishError = {};
      try {
        payload = JSON.parse(text) as PublishError;
      } catch {
        if (text) throw new Error(text.slice(0, 200));
      }
      const blocking = payload.issues?.filter((issue) => issue.level === 'error') ?? [];
      if (blocking.length > 0) {
        throw new Error(blocking.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
      }
      const message = payload.message ?? res.statusText;
      throw new Error(message ? `HTTP ${res.status}: ${message}` : `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ version: unknown; issues: unknown[] }>;
  },
  getSalesForecastReviewSummary: (id: string) =>
    request<{ summary: string; issues: unknown[] }>(
      `/api/sales-forecast-versions/${id}/review-summary`,
    ),
  getSalesForecastImpactPreview: (id: string) =>
    request<{
      versionId: string;
      versionName: string;
      station: string | null;
      skuCount: number;
      forecastRowCount: number;
      lowConfidenceCount: number;
      redSkuCount: number;
      yellowSkuCount: number;
      summary: string;
    }>(`/api/sales-forecast-versions/${id}/impact-preview`),
  getSalesForecasts: (params?: {
    skuCode?: string;
    station?: string;
    platform?: string;
    versionId?: string;
    forecastMonth?: string;
    year?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.forecastMonth) qs.set('forecastMonth', params.forecastMonth);
    if (params?.year) qs.set('year', String(params.year));
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuCode: string;
        skuName: string;
        station: string;
        platform: string;
        forecastMonth: string;
        forecastYear: number;
        month: number;
        forecastDailyAvg: number;
        baselineDailyAvg?: number | null;
        manualDailyAvg?: number | null;
        adjustReason?: string | null;
        confidenceLevel?: string | null;
        ownerName?: string | null;
        versionId?: string | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales-forecasts${query ? `?${query}` : ''}`);
  },
  updateSalesForecast: (
    id: string,
    body: {
      forecastDailyAvg?: number;
      baselineDailyAvg?: number;
      manualDailyAvg?: number | null;
      clearManual?: boolean;
      lifecycle?: string;
      ownerName?: string;
      platform?: string;
      adjustReason?: string | null;
      confidenceLevel?: 'high' | 'medium' | 'low';
    },
  ) =>
    request<{
      id: string;
      skuCode: string;
      skuName: string;
      station: string;
      platform: string;
      forecastMonth: string;
      forecastYear: number;
      month: number;
      forecastDailyAvg: number;
      manualDailyAvg?: number | null;
      effectiveDailyAvg: number;
      baselineDailyAvg?: number | null;
      adjustReason?: string | null;
      confidenceLevel?: string | null;
      lifecycle?: string | null;
      ownerName?: string | null;
      versionId?: string | null;
    }>(`/api/sales-forecasts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getSalesForecastAccuracyDiagnostics: (params?: {
    versionId?: string;
    versionName?: string;
    station?: string;
    platform?: string;
    startMonth?: string;
    endMonth?: string;
    asOf?: string;
    limitTopErrors?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.versionName) qs.set('versionName', params.versionName);
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.startMonth) qs.set('startMonth', params.startMonth);
    if (params?.endMonth) qs.set('endMonth', params.endMonth);
    if (params?.asOf) qs.set('asOf', params.asOf);
    if (params?.limitTopErrors != null) qs.set('limitTopErrors', String(params.limitTopErrors));
    const query = qs.toString();
    return request<ForecastAccuracyDiagnostics>(
      `/api/sales-forecasts/accuracy/diagnostics${query ? `?${query}` : ''}`,
    );
  },
  createSalesForecastAccuracyReviewQueue: (body: {
    sourceVersionId?: string;
    sourceVersionName?: string;
    targetVersionId: string;
    station?: string;
    platform?: string;
    startMonth?: string;
    endMonth?: string;
    limit?: number;
    minWmape?: number;
  }) =>
    request<ForecastAccuracyReviewQueueResult>('/api/sales-forecasts/accuracy/review-queue', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSalesForecastAccuracy: (params?: {
    year?: number;
    month?: number;
    station?: string;
    platform?: string;
    versionId?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.year) qs.set('year', String(params.year));
    if (params?.month) qs.set('month', String(params.month));
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuCode: string;
        station: string;
        platform: string;
        forecastMonth: string;
        forecastDailyAvg: number;
        actualDailyAvg: number;
        biasRate: number | null;
        biasVsActual: number | null;
        mape: number | null;
        profileSegment: string | null;
        profileSegmentLabel: string | null;
      }>;
      summary: string;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/sales-forecasts/accuracy${query ? `?${query}` : ''}`);
  },
  exportSalesForecastAccuracy: async (params?: {
    versionId?: string;
    year?: number;
    month?: number;
    station?: string;
    platform?: string;
    groupBy?: 'sku' | 'month';
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.year) qs.set('year', String(params.year));
    if (params?.month) qs.set('month', String(params.month));
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.groupBy === 'sku') qs.set('groupBy', 'sku');
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales-forecasts/accuracy/export${query ? `?${query}` : ''}`));
    await downloadAttachment(res, params?.groupBy === 'sku' ? 'forecast-accuracy-sku-summary.csv' : 'forecast-accuracy.csv');
  },
  getSalesForecastAccuracySummary: (params?: {
    versionId?: string;
    year?: number;
    month?: number;
    station?: string;
    platform?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.versionId) qs.set('versionId', params.versionId);
    if (params?.year) qs.set('year', String(params.year));
    if (params?.month) qs.set('month', String(params.month));
    if (params?.station) qs.set('station', params.station);
    if (params?.platform) qs.set('platform', params.platform);
    const query = qs.toString();
    return request<{
      global: {
        tier: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        highMapePct: number;
      };
      byTier: Array<{
        tier: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        highMapePct: number;
      }>;
      byCategory: Array<{
        category: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        highMapePct: number;
      }>;
      byHorizonBand?: Array<{
        band: string;
        label: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
        ghostRowCount: number;
      }>;
      byProfileClass?: Array<{
        profileClass: string;
        skuCount: number;
        comparableRows: number;
        wmape: number | null;
        weightedBias: number | null;
      }>;
      bySegment?: Array<{
        segment: string;
        segmentLabel: string;
        parentClass: string;
        measurable: boolean;
        bands: Record<
          string,
          {
            skuCount: number;
            comparableRows: number;
            wmape: number | null;
            weightedBias: number | null;
            kpiTarget: number | null;
            kpiStatus: string;
            ghostRowCount: number;
          }
        >;
      }>;
      matrix?: {
        cells: Array<{
          segment: string;
          segmentLabel: string;
          band: HorizonBand;
          bandLabel: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          kpiTarget: number | null;
          kpiTargetLabel: string;
          kpiStatus: 'pass' | 'warn' | 'fail' | 'na' | 'display_only';
          ghostRowCount: number;
          intervalCoverage: number | null;
        }>;
      };
    }>(`/api/sales-forecasts/accuracy/summary${query ? `?${query}` : ''}`);
  },
  aggregateSalesHistoryMonthly: (body?: { lookbackMonths?: number }) =>
    request<{
      aggregate: { upsertedRows: number; lookbackMonths: number; cutoffDate: string };
      coverage: {
        rowCount: number;
        skuCount: number;
        startMonth: string | null;
        endMonth: string | null;
      };
    }>('/api/sales-forecasts/monthly-sales/aggregate', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  backtestSalesForecastAccuracy: (body?: {
    monthCount?: number;
    versionId?: string;
    createReviewItems?: boolean;
  }) =>
    request<{
      monthCount: number;
      monthResults: Array<{
        year: number;
        month: number;
        upserted: number;
        highMapeCount: number;
        skipped?: boolean;
      }>;
      totalUpserted: number;
      totalHighMapeCount: number;
      summary: string;
    }>('/api/sales-forecasts/accuracy/backtest', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  walkForwardSalesForecastAccuracy: (body?: {
    asOf?: string;
    monthCount?: number;
    station?: string;
    platform?: string;
    skuCode?: string;
    versionName?: string;
    createReviewItems?: boolean;
    exportCsvPath?: string;
    tierFilter?: 'core' | 'mid' | 'tail' | 'all';
  }) =>
    request<{
      asOf: string;
      monthCount: number;
      version: { id: string; versionName: string; status: string };
      forecastRows: number;
      reviewRows: number;
      eligibilityStats?: {
        eligible: number;
        skipped: number;
        byTier: { core: number; mid: number; tail: number };
      };
      targetMonthLabels: string[];
      monthResults: Array<{
        year: number;
        month: number;
        monthLabel: string;
        upserted: number;
        highMapeCount: number;
        skipped?: boolean;
        avgMape: number | null;
        avgBiasRate: number | null;
        comparableRows: number;
      }>;
      totalUpserted: number;
      totalHighMapeCount: number;
      csvPath: string;
      csvRows: number;
      tierSummary?: {
        global: {
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        };
        byTier: Array<{
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        }>;
        byCategory: Array<{
          category: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        }>;
      };
      segmentSummary?: {
        global: {
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        };
        byTier: Array<{
          tier: string;
          skuCount: number;
          comparableRows: number;
          wmape: number | null;
          weightedBias: number | null;
          highMapePct: number;
        }>;
        matrix?: {
          cells: Array<{
            segment: string;
            segmentLabel: string;
            band: HorizonBand;
            bandLabel: string;
            skuCount: number;
            comparableRows: number;
            wmape: number | null;
            weightedBias: number | null;
            kpiTarget: number | null;
            kpiTargetLabel: string;
            kpiStatus: 'pass' | 'warn' | 'fail' | 'na' | 'display_only';
            ghostRowCount: number;
            intervalCoverage: number | null;
          }>;
        };
      };
      accuracyList?: {
        items: Array<{
          id: string;
          skuCode: string;
          station: string;
          platform: string;
          forecastMonth: string;
          forecastDailyAvg: number;
          actualDailyAvg: number;
          biasRate: number | null;
          biasVsActual: number | null;
          mape: number | null;
          profileSegment: string | null;
          profileSegmentLabel: string | null;
        }>;
        total: number;
        page: number;
        pageSize: number;
      };
      monthTierSummary?: Array<{
        forecastYear: number;
        month: number;
        monthLabel: string;
        profileSegment: string;
        profileSegmentLabel: string;
        comparableRows: number;
        mape: number | null;
        wmape: number | null;
      }>;
      summary: string;
    }>('/api/sales-forecasts/accuracy/walkforward', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
};

async function downloadAttachment(res: Response, fallbackName: string) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message ?? '下载失败');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="([^"]+)"/i);
  const filename = utf8Match
    ? decodeURIComponent(utf8Match[1])
    : plainMatch
      ? plainMatch[1]
      : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}


