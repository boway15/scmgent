# Review P1 Task4
BASE: bfec1bd3f70861ecc5c7ea4bf2537009b7e5ebe3
HEAD: 47e09b1b264eca357c093fe74c4e89c785f6db75
## Commits
47e09b1 feat: add lead time profile API and admin page

## Stat
 .superpowers/sdd/task-p1-4-report.md              |  10 +
 apps/web/server/index.ts                          |   2 +
 apps/web/server/routes/lead-time-profiles.test.ts |  80 ++++++
 apps/web/server/routes/lead-time-profiles.ts      | 159 +++++++++++
 apps/web/src/lib/api.ts                           |  43 +++
 apps/web/src/pages/LeadTimeProfilesPage.tsx       | 314 ++++++++++++++++++++++
 apps/web/src/router.tsx                           |   2 +
 packages/db/drizzle/0054_lead_time_menu.sql       |  17 ++
 packages/db/src/seed.ts                           |   7 +-
 9 files changed, 631 insertions(+), 3 deletions(-)

## Diff
diff --git a/apps/web/server/index.ts b/apps/web/server/index.ts
index 297ef90..58d7f57 100644
--- a/apps/web/server/index.ts
+++ b/apps/web/server/index.ts
@@ -44,10 +44,11 @@ import { salesRoutes } from './routes/sales.js';
 import { auditLogRoutes } from './routes/audit-logs.js';
 import { skuEncodingRoutes } from './routes/sku-encoding.js';
 import { inventoryHealthRoutes } from './routes/inventory-health.js';
 import { salesForecastRoutes } from './routes/sales-forecast.js';
 import { inventoryExceptionRoutes } from './routes/inventory-exceptions.js';
+import { leadTimeProfileRoutes } from './routes/lead-time-profiles.js';
 import { sql } from 'drizzle-orm';
 import { db } from '@scm/db';
 import { getRuntimeConfigSummary } from './lib/runtime-config.js';
 
 /** 濡欐惌瀛愯矾寰勭敱 Nest 妗ユ帴鍓ョ锛汬ono 璺敱鍥哄畾 /api/*锛堝嬁鍐?basePath锛?*/
@@ -142,10 +143,11 @@ app.route('/api', salesRoutes);
 app.route('/api', auditLogRoutes);
 app.route('/api', skuEncodingRoutes);
 app.route('/api', inventoryHealthRoutes);
 app.route('/api', salesForecastRoutes);
 app.route('/api', inventoryExceptionRoutes);
+app.route('/api', leadTimeProfileRoutes);
 app.route('/api', newsIntelRoutes);
 app.route('/api', csReplyQualityRoutes);
 
 if (serveStaticFiles) {
   app.use('/*', serveStatic({ root: distRoot }));
diff --git a/apps/web/server/routes/lead-time-profiles.test.ts b/apps/web/server/routes/lead-time-profiles.test.ts
new file mode 100644
index 0000000..c03c711
--- /dev/null
+++ b/apps/web/server/routes/lead-time-profiles.test.ts
@@ -0,0 +1,80 @@
+import assert from 'node:assert/strict';
+import { describe, it } from 'node:test';
+import { parseLeadTimeProfileInput } from './lead-time-profiles.js';
+
+describe('lead-time profile input', () => {
+  it('normalizes optional text and accepts non-negative day values', () => {
+    assert.deepEqual(
+      parseLeadTimeProfileInput({
+        merchantCode: ' M1 ',
+        originLocation: ' Shenzhen ',
+        destinationWarehouseCode: ' US-WEST ',
+        transportMode: 'fcl',
+        productionDays: 12,
+        domesticDays: 2,
+        bookingDays: 3,
+        transitDays: 18,
+        customsDays: 4,
+        inboundDays: 1,
+        leadTimeStdDev: 5,
+        isDefault: true,
+      }),
+      {
+        ok: true,
+        value: {
+          merchantCode: 'M1',
+          originLocation: 'Shenzhen',
+          destinationWarehouseCode: 'US-WEST',
+          transportMode: 'fcl',
+          productionDays: 12,
+          domesticDays: 2,
+          bookingDays: 3,
+          transitDays: 18,
+          customsDays: 4,
+          inboundDays: 1,
+          leadTimeStdDev: 5,
+          isDefault: true,
+          sourceSystem: null,
+          externalId: null,
+        },
+      },
+    );
+  });
+
+  it('rejects missing warehouse and invalid day values', () => {
+    assert.deepEqual(
+      parseLeadTimeProfileInput({
+        destinationWarehouseCode: ' ',
+        productionDays: -1,
+      }),
+      {
+        ok: false,
+        message: 'destinationWarehouseCode is required',
+      },
+    );
+
+    assert.deepEqual(
+      parseLeadTimeProfileInput({
+        destinationWarehouseCode: 'US-WEST',
+        transitDays: 1.5,
+      }),
+      {
+        ok: false,
+        message: 'transitDays must be a non-negative integer',
+      },
+    );
+  });
+
+  it('rejects unsupported transport modes', () => {
+    assert.deepEqual(
+      parseLeadTimeProfileInput({
+        destinationWarehouseCode: 'US-WEST',
+        transportMode: 'sea',
+      }),
+      {
+        ok: false,
+        message: 'transportMode is invalid',
+      },
+    );
+  });
+});
diff --git a/apps/web/server/routes/lead-time-profiles.ts b/apps/web/server/routes/lead-time-profiles.ts
new file mode 100644
index 0000000..9c0a95c
--- /dev/null
+++ b/apps/web/server/routes/lead-time-profiles.ts
@@ -0,0 +1,159 @@
+import { and, desc, eq } from 'drizzle-orm';
+import { Hono } from 'hono';
+import { db, leadTimeProfiles } from '@scm/db';
+import { requireMenu } from '../lib/rbac.js';
+
+const TRANSPORT_MODES = ['fcl', 'lcl', 'air', 'express', 'rail', 'truck_air', 'direct'] as const;
+type TransportMode = (typeof TRANSPORT_MODES)[number];
+
+type LeadTimeProfileInput = {
+  merchantCode?: unknown;
+  originLocation?: unknown;
+  destinationWarehouseCode?: unknown;
+  transportMode?: unknown;
+  productionDays?: unknown;
+  domesticDays?: unknown;
+  bookingDays?: unknown;
+  transitDays?: unknown;
+  customsDays?: unknown;
+  inboundDays?: unknown;
+  leadTimeStdDev?: unknown;
+  isDefault?: unknown;
+  sourceSystem?: unknown;
+  externalId?: unknown;
+};
+
+type ParsedLeadTimeProfile = {
+  merchantCode: string | null;
+  originLocation: string | null;
+  destinationWarehouseCode: string;
+  transportMode: TransportMode | null;
+  productionDays: number;
+  domesticDays: number;
+  bookingDays: number;
+  transitDays: number;
+  customsDays: number;
+  inboundDays: number;
+  leadTimeStdDev: number | null;
+  isDefault: boolean;
+  sourceSystem: string | null;
+  externalId: string | null;
+};
+
+function optionalText(value: unknown): string | null {
+  return typeof value === 'string' ? value.trim() || null : null;
+}
+
+export function parseLeadTimeProfileInput(
+  body: LeadTimeProfileInput,
+): { ok: true; value: ParsedLeadTimeProfile } | { ok: false; message: string } {
+  const destinationWarehouseCode = optionalText(body.destinationWarehouseCode);
+  if (!destinationWarehouseCode) {
+    return { ok: false, message: 'destinationWarehouseCode is required' };
+  }
+
+  const transportMode = optionalText(body.transportMode);
+  if (transportMode && !TRANSPORT_MODES.includes(transportMode as TransportMode)) {
+    return { ok: false, message: 'transportMode is invalid' };
+  }
+
+  const dayFields = [
+    'productionDays',
+    'domesticDays',
+    'bookingDays',
+    'transitDays',
+    'customsDays',
+    'inboundDays',
+  ] as const;
+  const days: Record<(typeof dayFields)[number], number> = {
+    productionDays: 0,
+    domesticDays: 0,
+    bookingDays: 0,
+    transitDays: 0,
+    customsDays: 0,
+    inboundDays: 0,
+  };
+  for (const field of dayFields) {
+    const value = body[field] ?? 0;
+    if (!Number.isInteger(value) || (value as number) < 0) {
+      return { ok: false, message: `${field} must be a non-negative integer` };
+    }
+    days[field] = value as number;
+  }
+
+  const leadTimeStdDev = body.leadTimeStdDev ?? null;
+  if (
+    leadTimeStdDev !== null &&
+    (!Number.isInteger(leadTimeStdDev) || (leadTimeStdDev as number) < 0)
+  ) {
+    return { ok: false, message: 'leadTimeStdDev must be a non-negative integer' };
+  }
+
+  return {
+    ok: true,
+    value: {
+      merchantCode: optionalText(body.merchantCode),
+      originLocation: optionalText(body.originLocation),
+      destinationWarehouseCode,
+      transportMode: transportMode as TransportMode | null,
+      ...days,
+      leadTimeStdDev: leadTimeStdDev as number | null,
+      isDefault: body.isDefault === true,
+      sourceSystem: optionalText(body.sourceSystem),
+      externalId: optionalText(body.externalId),
+    },
+  };
+}
+
+export const leadTimeProfileRoutes = new Hono();
+const leadTimeMenu = requireMenu('inventory.lead_time');
+
+leadTimeProfileRoutes.get('/lead-time-profiles', leadTimeMenu, async (c) => {
+  const warehouse = c.req.query('warehouse')?.trim();
+  const merchant = c.req.query('merchant')?.trim();
+  const conditions = [];
+  if (warehouse) conditions.push(eq(leadTimeProfiles.destinationWarehouseCode, warehouse));
+  if (merchant) conditions.push(eq(leadTimeProfiles.merchantCode, merchant));
+
+  const items = await db
+    .select()
+    .from(leadTimeProfiles)
+    .where(conditions.length ? and(...conditions) : undefined)
+    .orderBy(desc(leadTimeProfiles.updatedAt), leadTimeProfiles.destinationWarehouseCode);
+  return c.json({ items });
+});
+
+leadTimeProfileRoutes.post('/lead-time-profiles', leadTimeMenu, async (c) => {
+  const body = await c.req.json<LeadTimeProfileInput & { id?: string }>();
+  const parsed = parseLeadTimeProfileInput(body);
+  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
+
+  const now = new Date();
+  const profileId = body.id;
+  if (profileId) {
+    const [row] = await db
+      .update(leadTimeProfiles)
+      .set({ ...parsed.value, updatedAt: now })
+      .where(eq(leadTimeProfiles.id, profileId))
+      .returning();
+    if (!row) return c.json({ message: 'Lead-time profile not found' }, 404);
+    return c.json(row);
+  }
+
+  const [row] = await db
+    .insert(leadTimeProfiles)
+    .values({ ...parsed.value, updatedAt: now })
+    .returning();
+  return c.json(row, 201);
+});
+
+leadTimeProfileRoutes.delete('/lead-time-profiles/:id', leadTimeMenu, async (c) => {
+  const profileId = c.req.param('id');
+  if (!profileId) return c.json({ message: 'id is required' }, 400);
+  const [row] = await db
+    .delete(leadTimeProfiles)
+    .where(eq(leadTimeProfiles.id, profileId))
+    .returning({ id: leadTimeProfiles.id });
+  if (!row) return c.json({ message: 'Lead-time profile not found' }, 404);
+  return c.json({ ok: true });
+});
diff --git a/apps/web/src/lib/api.ts b/apps/web/src/lib/api.ts
index 3acce6e..e19ffac 100644
--- a/apps/web/src/lib/api.ts
+++ b/apps/web/src/lib/api.ts
@@ -110,10 +110,37 @@ export type Merchant = {
   productionLeadDays?: number | null;
   remark?: string | null;
   isActive: boolean;
 };
 
+export type TransportMode = 'fcl' | 'lcl' | 'air' | 'express' | 'rail' | 'truck_air' | 'direct';
+
+export type LeadTimeProfile = {
+  id: string;
+  merchantCode?: string | null;
+  originLocation?: string | null;
+  destinationWarehouseCode: string;
+  transportMode?: TransportMode | null;
+  productionDays: number;
+  domesticDays: number;
+  bookingDays: number;
+  transitDays: number;
+  customsDays: number;
+  inboundDays: number;
+  leadTimeStdDev?: number | null;
+  isDefault: boolean;
+  sourceSystem?: string | null;
+  externalId?: string | null;
+  createdAt: string;
+  updatedAt: string;
+};
+
+export type LeadTimeProfileInput = Omit<
+  LeadTimeProfile,
+  'id' | 'createdAt' | 'updatedAt'
+> & { id?: string };
+
 export type SkuOverview = {
   id: string;
   code: string;
   name: string;
   unit: string;
@@ -1371,10 +1398,26 @@ export const api = {
         regionGroup: string;
         countryCode?: string | null;
         allowCrossFulfill: boolean;
       }>
     >('/api/warehouses'),
+  getLeadTimeProfiles: (params?: { warehouse?: string; merchant?: string }) => {
+    const qs = new URLSearchParams();
+    if (params?.warehouse) qs.set('warehouse', params.warehouse);
+    if (params?.merchant) qs.set('merchant', params.merchant);
+    const query = qs.toString();
+    return request<{ items: LeadTimeProfile[] }>(
+      `/api/lead-time-profiles${query ? `?${query}` : ''}`,
+    );
+  },
+  upsertLeadTimeProfile: (data: LeadTimeProfileInput) =>
+    request<LeadTimeProfile>('/api/lead-time-profiles', {
+      method: 'POST',
+      body: JSON.stringify(data),
+    }),
+  deleteLeadTimeProfile: (id: string) =>
+    request<{ ok: true }>(`/api/lead-time-profiles/${id}`, { method: 'DELETE' }),
   getChannelWarehousePrefs: () =>
     request<
       Array<{
         channel: string;
         primaryWarehouseCode: string;
diff --git a/apps/web/src/pages/LeadTimeProfilesPage.tsx b/apps/web/src/pages/LeadTimeProfilesPage.tsx
new file mode 100644
index 0000000..16e6047
--- /dev/null
+++ b/apps/web/src/pages/LeadTimeProfilesPage.tsx
@@ -0,0 +1,314 @@
+import { useState } from 'react';
+import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
+import { api, type LeadTimeProfile, type LeadTimeProfileInput, type TransportMode } from '@/lib/api';
+import { PageHeader } from '@/components/PageHeader';
+import { Button } from '@/components/ui/button';
+import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
+import { Input } from '@/components/ui/input';
+
+type ProfileForm = {
+  id?: string;
+  merchantCode: string;
+  originLocation: string;
+  destinationWarehouseCode: string;
+  transportMode: '' | TransportMode;
+  productionDays: string;
+  domesticDays: string;
+  bookingDays: string;
+  transitDays: string;
+  customsDays: string;
+  inboundDays: string;
+  leadTimeStdDev: string;
+  isDefault: boolean;
+};
+
+const EMPTY_FORM: ProfileForm = {
+  merchantCode: '',
+  originLocation: '',
+  destinationWarehouseCode: '',
+  transportMode: '',
+  productionDays: '0',
+  domesticDays: '0',
+  bookingDays: '0',
+  transitDays: '0',
+  customsDays: '0',
+  inboundDays: '0',
+  leadTimeStdDev: '',
+  isDefault: false,
+};
+
+const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
+  fcl: '鏁存煖',
+  lcl: '鎷肩',
+  air: '绌鸿繍',
+  express: '蹇€?,
+  rail: '閾佽矾',
+  truck_air: '鍗¤埅',
+  direct: '鐩村彂',
+};
+
+const DAY_FIELDS = [
+  ['productionDays', '鐢熶骇'],
+  ['domesticDays', '鍥藉唴'],
+  ['bookingDays', '璁㈣埍'],
+  ['transitDays', '骞茬嚎'],
+  ['customsDays', '娓呭叧'],
+  ['inboundDays', '鍏ヤ粨'],
+] as const;
+
+function profileToForm(profile: LeadTimeProfile): ProfileForm {
+  return {
+    id: profile.id,
+    merchantCode: profile.merchantCode ?? '',
+    originLocation: profile.originLocation ?? '',
+    destinationWarehouseCode: profile.destinationWarehouseCode,
+    transportMode: profile.transportMode ?? '',
+    productionDays: String(profile.productionDays),
+    domesticDays: String(profile.domesticDays),
+    bookingDays: String(profile.bookingDays),
+    transitDays: String(profile.transitDays),
+    customsDays: String(profile.customsDays),
+    inboundDays: String(profile.inboundDays),
+    leadTimeStdDev: profile.leadTimeStdDev == null ? '' : String(profile.leadTimeStdDev),
+    isDefault: profile.isDefault,
+  };
+}
+
+function formToInput(form: ProfileForm): LeadTimeProfileInput {
+  return {
+    id: form.id,
+    merchantCode: form.merchantCode || null,
+    originLocation: form.originLocation || null,
+    destinationWarehouseCode: form.destinationWarehouseCode,
+    transportMode: form.transportMode || null,
+    productionDays: Number(form.productionDays),
+    domesticDays: Number(form.domesticDays),
+    bookingDays: Number(form.bookingDays),
+    transitDays: Number(form.transitDays),
+    customsDays: Number(form.customsDays),
+    inboundDays: Number(form.inboundDays),
+    leadTimeStdDev: form.leadTimeStdDev === '' ? null : Number(form.leadTimeStdDev),
+    isDefault: form.isDefault,
+    sourceSystem: null,
+    externalId: null,
+  };
+}
+
+export function LeadTimeProfilesPage() {
+  const queryClient = useQueryClient();
+  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
+  const [filters, setFilters] = useState({ warehouse: '', merchant: '' });
+  const [appliedFilters, setAppliedFilters] = useState(filters);
+  const [error, setError] = useState('');
+
+  const profiles = useQuery({
+    queryKey: ['lead-time-profiles', appliedFilters],
+    queryFn: () =>
+      api.getLeadTimeProfiles({
+        warehouse: appliedFilters.warehouse || undefined,
+        merchant: appliedFilters.merchant || undefined,
+      }),
+  });
+
+  const save = useMutation({
+    mutationFn: (data: LeadTimeProfileInput) => api.upsertLeadTimeProfile(data),
+    onSuccess: () => {
+      setForm(EMPTY_FORM);
+      setError('');
+      void queryClient.invalidateQueries({ queryKey: ['lead-time-profiles'] });
+    },
+    onError: (err) => setError(err instanceof Error ? err.message : '淇濆瓨澶辫触'),
+  });
+
+  const remove = useMutation({
+    mutationFn: api.deleteLeadTimeProfile,
+    onSuccess: () => {
+      setError('');
+      void queryClient.invalidateQueries({ queryKey: ['lead-time-profiles'] });
+    },
+    onError: (err) => setError(err instanceof Error ? err.message : '鍒犻櫎澶辫触'),
+  });
+
+  const items = profiles.data?.items ?? [];
+
+  return (
+    <div className="space-y-6">
+      <PageHeader title="浜ゆ湡閰嶇疆" />
+
+      <Card>
+        <CardHeader>
+          <CardTitle>{form.id ? '缂栬緫浜ゆ湡 Profile' : '鏂板缓浜ゆ湡 Profile'}</CardTitle>
+        </CardHeader>
+        <CardContent className="space-y-4">
+          <div className="grid gap-3 md:grid-cols-4">
+            <Input
+              placeholder="浠撳簱缂栫爜锛堝繀濉級"
+              value={form.destinationWarehouseCode}
+              onChange={(event) =>
+                setForm({ ...form, destinationWarehouseCode: event.target.value })
+              }
+            />
+            <Input
+              placeholder="鍟嗗缂栫爜锛堢┖=浠撳簱榛樿锛?
+              value={form.merchantCode}
+              onChange={(event) => setForm({ ...form, merchantCode: event.target.value })}
+            />
+            <Input
+              placeholder="璧疯繍鍦?
+              value={form.originLocation}
+              onChange={(event) => setForm({ ...form, originLocation: event.target.value })}
+            />
+            <select
+              className="h-10 rounded-md border border-border bg-card px-3 text-sm"
+              value={form.transportMode}
+              onChange={(event) =>
+                setForm({ ...form, transportMode: event.target.value as ProfileForm['transportMode'] })
+              }
+            >
+              <option value="">鍏ㄩ儴杩愯緭鏂瑰紡</option>
+              {Object.entries(TRANSPORT_MODE_LABELS).map(([value, label]) => (
+                <option key={value} value={value}>
+                  {label}
+                </option>
+              ))}
+            </select>
+          </div>
+
+          <div className="grid gap-3 md:grid-cols-6">
+            {DAY_FIELDS.map(([field, label]) => (
+              <label key={field} className="space-y-1 text-sm text-text-sub">
+                <span>{label}澶╂暟</span>
+                <Input
+                  type="number"
+                  min={0}
+                  value={form[field]}
+                  onChange={(event) => setForm({ ...form, [field]: event.target.value })}
+                />
+              </label>
+            ))}
+          </div>
+
+          <div className="flex flex-wrap items-end gap-3">
+            <label className="w-40 space-y-1 text-sm text-text-sub">
+              <span>娉㈠姩鏍囧噯宸紙澶╋級</span>
+              <Input
+                type="number"
+                min={0}
+                value={form.leadTimeStdDev}
+                onChange={(event) => setForm({ ...form, leadTimeStdDev: event.target.value })}
+              />
+            </label>
+            <label className="flex h-10 items-center gap-2 text-sm text-text-sub">
+              <input
+                type="checkbox"
+                checked={form.isDefault}
+                onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
+              />
+              榛樿 Profile
+            </label>
+            <Button
+              onClick={() => save.mutate(formToInput(form))}
+              disabled={save.isPending || !form.destinationWarehouseCode.trim()}
+            >
+              {save.isPending ? '淇濆瓨涓?..' : '淇濆瓨'}
+            </Button>
+            {form.id && (
+              <Button variant="outline" onClick={() => setForm(EMPTY_FORM)}>
+                鍙栨秷缂栬緫
+              </Button>
+            )}
+          </div>
+          {error && <p className="text-sm text-red-600">{error}</p>}
+        </CardContent>
+      </Card>
+
+      <Card>
+        <CardHeader>
+          <CardTitle>Profile 鍒楄〃</CardTitle>
+        </CardHeader>
+        <CardContent>
+          <div className="mb-4 flex flex-wrap gap-3">
+            <Input
+              className="w-52"
+              placeholder="鎸変粨搴撶紪鐮佺瓫閫?
+              value={filters.warehouse}
+              onChange={(event) => setFilters({ ...filters, warehouse: event.target.value })}
+            />
+            <Input
+              className="w-52"
+              placeholder="鎸夊晢瀹剁紪鐮佺瓫閫?
+              value={filters.merchant}
+              onChange={(event) => setFilters({ ...filters, merchant: event.target.value })}
+            />
+            <Button variant="outline" onClick={() => setAppliedFilters(filters)}>
+              鏌ヨ
+            </Button>
+          </div>
+
+          {profiles.isLoading ? (
+            <p className="text-sm text-text-sub">鍔犺浇涓?..</p>
+          ) : (
+            <div className="overflow-x-auto">
+              <table className="w-full text-sm">
+                <thead>
+                  <tr className="border-b border-border text-left text-text-sub">
+                    <th className="p-2 font-normal">浠撳簱</th>
+                    <th className="p-2 font-normal">鍟嗗</th>
+                    <th className="p-2 font-normal">鏂瑰紡</th>
+                    {DAY_FIELDS.map(([, label]) => (
+                      <th key={label} className="p-2 font-normal">{label}</th>
+                    ))}
+                    <th className="p-2 font-normal">鍚堣</th>
+                    <th className="p-2 font-normal">鎿嶄綔</th>
+                  </tr>
+                </thead>
+                <tbody>
+                  {items.map((profile) => {
+                    const total = DAY_FIELDS.reduce((sum, [field]) => sum + profile[field], 0);
+                    return (
+                      <tr key={profile.id} className="border-b border-border/60">
+                        <td className="p-2 font-mono">{profile.destinationWarehouseCode}</td>
+                        <td className="p-2 font-mono">{profile.merchantCode ?? '榛樿'}</td>
+                        <td className="p-2">
+                          {profile.transportMode
+                            ? TRANSPORT_MODE_LABELS[profile.transportMode]
+                            : '鍏ㄩ儴'}
+                        </td>
+                        {DAY_FIELDS.map(([field]) => (
+                          <td key={field} className="p-2 font-mono">{profile[field]}</td>
+                        ))}
+                        <td className="p-2 font-mono text-text-main">{total}</td>
+                        <td className="whitespace-nowrap p-2">
+                          <Button size="sm" variant="ghost" onClick={() => setForm(profileToForm(profile))}>
+                            缂栬緫
+                          </Button>
+                          <Button
+                            size="sm"
+                            variant="ghost"
+                            disabled={remove.isPending}
+                            onClick={() => {
+                              if (window.confirm('纭鍒犻櫎璇ヤ氦鏈?Profile锛?)) remove.mutate(profile.id);
+                            }}
+                          >
+                            鍒犻櫎
+                          </Button>
+                        </td>
+                      </tr>
+                    );
+                  })}
+                  {!items.length && (
+                    <tr>
+                      <td colSpan={11} className="p-6 text-center text-text-hint">
+                        鏆傛棤浜ゆ湡 Profile
+                      </td>
+                    </tr>
+                  )}
+                </tbody>
+              </table>
+            </div>
+          )}
+        </CardContent>
+      </Card>
+    </div>
+  );
+}
diff --git a/apps/web/src/router.tsx b/apps/web/src/router.tsx
index 26d0c91..3fa6147 100644
--- a/apps/web/src/router.tsx
+++ b/apps/web/src/router.tsx
@@ -1,10 +1,11 @@
 import { Routes, Route, Navigate } from 'react-router-dom';
 import { AppLayout } from '@/layouts/AppLayout';
 import { RequireAuth } from '@/components/RequireAuth';
 import { LoginPage } from '@/pages/LoginPage';
 import { InventoryOverviewPage } from '@/pages/InventoryOverviewPage';
+import { LeadTimeProfilesPage } from '@/pages/LeadTimeProfilesPage';
 import { SafetyStockPage } from '@/pages/SafetyStockPage';
 import { AlertsPage } from '@/pages/AlertsPage';
 import { ReorderSuggestionsPage } from '@/pages/ReorderSuggestionsPage';
 import { PurchaseTrackingPage } from '@/pages/PurchaseTrackingPage';
 import { RoleMenusPage } from '@/pages/RoleMenusPage';
@@ -37,10 +38,11 @@ export function AppRouter() {
       <Route element={<RequireAuth />}>
         <Route path="/" element={<AppLayout />}>
           <Route index element={<HomeRedirect />} />
           <Route path="dashboard" element={<DashboardPage />} />
           <Route path="inventory/overview" element={<InventoryOverviewPage />} />
+          <Route path="inventory/lead-time" element={<LeadTimeProfilesPage />} />
           <Route path="inventory/safety" element={<SafetyStockPage />} />
           <Route path="inventory/alerts" element={<AlertsPage />} />
           <Route path="pmc/suggestions" element={<ReorderSuggestionsPage />} />
           <Route path="pmc/list" element={<PmcListPage />} />
           <Route path="pmc/tracking" element={<PurchaseTrackingPage />} />
diff --git a/packages/db/drizzle/0054_lead_time_menu.sql b/packages/db/drizzle/0054_lead_time_menu.sql
new file mode 100644
index 0000000..42bee14
--- /dev/null
+++ b/packages/db/drizzle/0054_lead_time_menu.sql
@@ -0,0 +1,17 @@
+-- 浜ゆ湡 Profile 绠＄悊鑿滃崟锛涙部鐢ㄥ畨鍏ㄥ簱瀛橀厤缃殑瑙掕壊鑼冨洿銆?+INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf)
+SELECT '浜ゆ湡閰嶇疆', 'inventory.lead_time', NULL, '/inventory/lead-time',
+       (SELECT id FROM menus WHERE code = 'inventory' LIMIT 1), 5, true
+WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = 'inventory.lead_time');
+
+INSERT INTO role_menus (role_id, menu_id)
+SELECT r.id, m.id
+FROM roles r
+CROSS JOIN menus m
+WHERE r.code IN ('super_admin', 'pmc_planner', 'purchaser')
+  AND m.code = 'inventory.lead_time'
+  AND NOT EXISTS (
+    SELECT 1
+    FROM role_menus rm
+    WHERE rm.role_id = r.id AND rm.menu_id = m.id
+  );
diff --git a/packages/db/src/seed.ts b/packages/db/src/seed.ts
index 54f9e8a..66205b8 100644
--- a/packages/db/src/seed.ts
+++ b/packages/db/src/seed.ts
@@ -42,10 +42,11 @@ const MENU_SEEDS: MenuSeed[] = [
     isLeaf: false,
     children: [
       { code: 'inventory.overview', name: '搴撳瓨鎬昏', path: '/inventory/overview', sortOrder: 1, isLeaf: true },
       { code: 'inventory.safety', name: '瀹夊叏搴撳瓨璁剧疆', path: '/inventory/safety', sortOrder: 2, isLeaf: true },
       { code: 'inventory.alert', name: '缂鸿揣棰勮', path: '/inventory/alerts', sortOrder: 3, isLeaf: true },
+      { code: 'inventory.lead_time', name: '浜ゆ湡閰嶇疆', path: '/inventory/lead-time', sortOrder: 5, isLeaf: true },
     ],
   },
   {
     code: 'pmc',
     name: '涓嬪崟璁″垝',
@@ -177,14 +178,14 @@ const DEPRECATED_MENU_CODES = [
   'data.import',
   'data.forecast.strategy',
 ];
 
 const ROLE_MENU_CODES: Record<string, string[]> = {
-  super_admin: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'cs', 'cs.quality', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.sales', 'data.forecast', 'intel', 'intel.news', 'ai', 'ai.chat', 'help', 'system', 'system.users', 'system.roles', 'system.logs'],
-  pmc_planner: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'pmc', 'pmc.suggestion', 'pmc.list', 'procurement', 'procurement.bulk_stock', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
+  super_admin: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'inventory.lead_time', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'cs', 'cs.quality', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.sales', 'data.forecast', 'intel', 'intel.news', 'ai', 'ai.chat', 'help', 'system', 'system.users', 'system.roles', 'system.logs'],
+  pmc_planner: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.lead_time', 'pmc', 'pmc.suggestion', 'pmc.list', 'procurement', 'procurement.bulk_stock', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
   warehouse: ['dashboard', 'inventory', 'inventory.overview', 'inventory.alert', 'pmc', 'pmc.list', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
-  purchaser: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'pmc', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
+  purchaser: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'inventory.lead_time', 'pmc', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
   viewer: ['dashboard', 'inventory', 'inventory.overview', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
 };
 
 async function removeMenuTreeByCode(code: string) {
   const [menu] = await db.select({ id: menus.id }).from(menus).where(eq(menus.code, code)).limit(1);

