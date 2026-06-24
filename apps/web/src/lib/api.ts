import { apiFetch, apiUrl } from './base-path';

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
  replenishLight?: ReplenishLight;
  supplierCount: number;
  isActive: boolean;
};

export type InventoryOverview = {
  skuId: string;
  code: string;
  name: string;
  unit: string;
  spuId?: string | null;
  replenishLight: ReplenishLight;
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
  /** SKU 级在产池，各仓行展示相同值 */
  qtyInProduction: number;
  qtyReserved?: number;
  /** 本仓可售 + 在途 */
  localEffectiveQty: number;
  effectiveQty: number;
  currentQty: number;
  safetyStockQty?: number | null;
  reorderPoint?: number | null;
  status: 'normal' | 'alert' | 'danger' | 'stockout';
  needsReplenishment?: boolean;
  replenishEligible?: boolean;
  /** 库存健康五档灯（蓝/绿/黄/红/灰） */
  inventoryHealth?: InventoryHealth;
};

export type ImportType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'safety_stock'
  | 'merchants'
  | 'warehouse_leads'
  | 'sales_forecast'
  | 'pmc_plans';

export type BitableSyncType =
  | 'skus'
  | 'inventory'
  | 'sales'
  | 'merchants'
  | 'warehouse_leads'
  | 'inventory_policy'
  | 'sales_forecast';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  const res = await apiFetch(url, init);
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
  getSpus: () => request<Spu[]>('/api/spus'),
  createSpu: (data: Partial<Spu>) => request<Spu>('/api/spus', { method: 'POST', body: JSON.stringify(data) }),
  updateSpu: (id: string, data: Partial<Spu>) =>
    request<Spu>(`/api/spus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getMerchantsMaster: () => request<Merchant[]>('/api/merchants/master'),
  createMerchant: (data: Partial<Merchant>) =>
    request<Merchant>('/api/merchants', { method: 'POST', body: JSON.stringify(data) }),
  updateMerchant: (id: string, data: Partial<Merchant>) =>
    request<Merchant>(`/api/merchants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  getSkuOverview: () => request<SkuOverview[]>('/api/products/sku-overview'),
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
    }>('/api/dashboard'),
  getSalesHistory: (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    warehouse?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    if (params?.limit) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return request<{
      items: Array<{
        id: string;
        skuId: string;
        skuCode: string;
        skuName: string;
        saleDate: string;
        qtySold: number;
        channel?: string | null;
        warehouseCode?: string | null;
        source: string;
      }>;
      summary: { totalQty: number; rowCount: number };
    }>(`/api/sales/history${query ? `?${query}` : ''}`);
  },
  exportSalesHistoryCsv: async (params?: {
    skuCode?: string;
    from?: string;
    to?: string;
    channel?: string;
    warehouse?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.skuCode) qs.set('skuCode', params.skuCode);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.channel) qs.set('channel', params.channel);
    if (params?.warehouse) qs.set('warehouse', params.warehouse);
    const query = qs.toString();
    const res = await apiFetch(apiUrl(`/api/sales/history/export${query ? `?${query}` : ''}`));
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
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
  getInventoryOverview: () => request<InventoryOverview[]>('/api/inventory/overview'),
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
  getPurchaseTracking: () =>
    request<
      Array<{
        id: string;
        draftNo: string;
        skuCode: string;
        skuName: string;
        qty: number;
        expectedDate?: string | null;
        source: string;
        planId?: string | null;
        planNo?: string | null;
        merchantCode?: string | null;
        merchantName?: string | null;
        status: string;
        remark?: string | null;
      }>
    >('/api/purchase-drafts'),
  updatePurchaseTracking: (id: string, data: { status?: 'draft' | 'submitted' | 'cancelled' }) =>
    request(`/api/purchase-drafts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message ?? 'Import failed');
    }
    return res.json() as Promise<{
      imported: number;
      errors: string[];
      batchId?: string;
      batchStatus?: string;
      validationIssues?: ImportValidationIssue[];
    }>;
  },
  importInventoryCsv: (csv: string) =>
    request<{ imported: number; errors: string[] }>('/api/import/inventory', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  importSalesCsv: (csv: string) =>
    request<{ imported: number; errors: string[] }>('/api/import/sales', {
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
