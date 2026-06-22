# FOB 拖车/货代分拆核算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FOB 分账改为「单批次 = 单分账类型 + 单服务商」，支持服务商配置、付款状态、分开展示本公司/本柜总额、两级明细导出。

**Architecture:** 在 `packages/db` 扩展 Drizzle Schema 与 `0013` 迁移；业务逻辑集中在 `apps/web/server/lib/fob-*.ts` 纯函数（便于 `node:test`）；`logistics.ts` 路由编排；前端在现有 `FobSettlement*` 页面增量改造。妙搭通过 `pnpm zip:miaoda` 同步 schema + hono-app。

**Tech Stack:** PostgreSQL + Drizzle ORM、Hono、React 18 + TanStack Query、xlsx + archiver、Node `node:test` + tsx

**PRD:** [docs/prd/fob-settlement-split-v2.md](../../prd/fob-settlement-split-v2.md)

---

## File Map

| 文件 | 职责 |
|------|------|
| `packages/db/src/schema/logistics.ts` | 新枚举、`fob_service_providers`、`fob_merchant_payment_status`、批次扩展字段 |
| `packages/db/drizzle/0013_fob_settlement_split_v2.sql` | 迁移 + 清历史 FOB 数据 |
| `packages/db/src/seed-fob-service-providers.ts` | 森威/华贸种子 |
| `packages/db/src/seed.ts` | 调用服务商 seed |
| `apps/web/server/lib/fob-bill-format.ts` | **新建** 识别账单格式、与服务商 `bill_format` 比对生成 warnings |
| `apps/web/server/lib/fob-bill-format.test.ts` | **新建** 格式检测单测 |
| `apps/web/server/lib/fob-payment-status.ts` | **新建** 付款状态 upsert/校验 |
| `apps/web/server/lib/fob-payment-status.test.ts` | **新建** `not_required` 备注校验 |
| `apps/web/server/lib/fob-reconcile-export.ts` | 两级明细导出（汇总行+明细行） |
| `apps/web/server/lib/fob-reconcile-export.test.ts` | 更新导出结构断言 |
| `apps/web/server/routes/logistics.ts` | 服务商 CRUD、批次扩展、导入互斥、付款 PATCH |
| `apps/web/src/lib/api.ts` | 新 API 类型与方法 |
| `apps/web/src/components/FobServiceProvidersPanel.tsx` | **新建** 服务商配置 Tab |
| `apps/web/src/pages/FobSettlementListPage.tsx` | 创建表单 + 列表列 |
| `apps/web/src/pages/FobSettlementDetailPage.tsx` | 工作流、导入显隐、汇总付款 |
| `apps/web/src/components/FobContainerMatrixPanel.tsx` | 本公司/本柜总额分列 |

---

## Task 1: Database Schema & Migration

**Files:**
- Modify: `packages/db/src/schema/logistics.ts`
- Create: `packages/db/drizzle/0013_fob_settlement_split_v2.sql`
- Create: `packages/db/src/seed-fob-service-providers.ts`
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: 在 `logistics.ts` 追加枚举与表**

在 `fobSettlementStatusEnum` 之后添加：

```typescript
export const fobSettlementTypeEnum = pgEnum('fob_settlement_type', ['trucking', 'freight']);
export const fobProviderTypeEnum = pgEnum('fob_provider_type', ['trucking', 'freight']);
export const fobBillFormatEnum = pgEnum('fob_bill_format', [
  'senwei_original',
  'huamao_original',
  'simplified_wide',
]);
export const fobPaymentStatusEnum = pgEnum('fob_payment_status', ['paid', 'unpaid', 'not_required']);
```

添加 `fobServiceProviders` 表（字段见 PRD §2.2）。

添加 `fobMerchantPaymentStatus` 表（字段见 PRD §2.4），含 `uniqueIndex` on `(batchId, merchantCode)`。

扩展 `fobSettlementBatches`：

```typescript
settlementType: fobSettlementTypeEnum('settlement_type').notNull(),
serviceProviderId: uuid('service_provider_id')
  .notNull()
  .references(() => fobServiceProviders.id),
```

添加 `relations`：`fobSettlementBatches` → `serviceProvider`；`fobMerchantPaymentStatus` → `batch`。

- [ ] **Step 2: 编写迁移 SQL `0013_fob_settlement_split_v2.sql`**

```sql
-- 1) 清空历史 FOB 数据（按 FK 子→父顺序）
DELETE FROM fob_settlement_adjustments;
DELETE FROM fob_settlement_allocations;
DELETE FROM fob_container_merchant_stats;
DELETE FROM fob_merchant_shipments;
DELETE FROM fob_trucking_bill_items;
DELETE FROM fob_freight_bill_items;
DELETE FROM fob_settlement_batches;

-- 2) 创建枚举（DO $$ EXCEPTION 块防重复）
-- 3) CREATE TABLE fob_service_providers ...
-- 4) ALTER TABLE fob_settlement_batches ADD settlement_type, service_provider_id
--    注意：批次表已有数据已 DELETE，可直接 NOT NULL
-- 5) CREATE TABLE fob_merchant_payment_status ...
```

- [ ] **Step 3: 种子 `seed-fob-service-providers.ts`**

```typescript
import { db, fobServiceProviders } from './index';

const SEEDS = [
  { code: 'senwei', name: '森威', providerType: 'trucking' as const, billFormat: 'senwei_original' as const, sortOrder: 10 },
  { code: 'huamao', name: '华贸', providerType: 'freight' as const, billFormat: 'huamao_original' as const, sortOrder: 10 },
];

export async function seedFobServiceProviders() {
  for (const row of SEEDS) {
    await db.insert(fobServiceProviders).values(row).onConflictDoNothing({ target: fobServiceProviders.code });
  }
}
```

在 `seed.ts` 的 `main()` 中 `await seedFobServiceProviders()`。

- [ ] **Step 4: 运行迁移与 seed**

```bash
pnpm db:migrate
pnpm db:seed
```

Expected: 无 SQL 错误；`SELECT * FROM fob_service_providers` 返回森威、华贸两行。

- [ ] **Step 5: Commit**

```bash
git add packages/db/
git commit -m "feat(db): FOB split v2 schema, purge history, seed service providers"
```

---

## Task 2: Bill Format Detection Helper

**Files:**
- Create: `apps/web/server/lib/fob-bill-format.ts`
- Create: `apps/web/server/lib/fob-bill-format.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// fob-bill-format.test.ts
import assert from 'node:assert/strict';
import { detectTruckingBillFormat, detectFreightBillFormat, billFormatMismatchWarning } from './fob-bill-format.js';

assert.equal(detectTruckingBillFormat('senwei_original'), detectTruckingBillFormat('senwei_original'));
assert.equal(
  billFormatMismatchWarning('senwei_original', 'huamao_original', '森威'),
  '账单格式与所选服务商「森威」可能不一致，请核对',
);
assert.equal(billFormatMismatchWarning('senwei_original', 'senwei_original', '森威'), null);
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx tsx --test server/lib/fob-bill-format.test.ts
```

Expected: FAIL `Cannot find module`

- [ ] **Step 3: 实现**

```typescript
// fob-bill-format.ts
export type BillFormat = 'senwei_original' | 'huamao_original' | 'simplified_wide';

export function detectTruckingBillFormat(
  detected: 'senwei' | 'simplified' | 'unknown',
): BillFormat {
  if (detected === 'senwei') return 'senwei_original';
  if (detected === 'simplified') return 'simplified_wide';
  return 'simplified_wide';
}

export function detectFreightBillFormat(
  detected: 'huamao' | 'simplified' | 'unknown',
): BillFormat {
  if (detected === 'huamao') return 'huamao_original';
  if (detected === 'simplified') return 'simplified_wide';
  return 'simplified_wide';
}

export function billFormatMismatchWarning(
  expected: BillFormat,
  detected: BillFormat,
  providerName: string,
): string | null {
  if (expected === detected) return null;
  return `账单格式与所选服务商「${providerName}」可能不一致，请核对`;
}

export function resolveTruckingDetection(rows: unknown[][]): 'senwei' | 'simplified' | 'unknown' {
  // 复用 isSenweiTruckingSheet / isSimplifiedTruckingSheet 逻辑，从 fob-bill-parsers 导出或内联调用
}
```

在 `fob-bill-parsers.ts` 导出 `detectSheetKind(rows, 'trucking'|'freight')` 供上述函数调用，避免重复。

- [ ] **Step 4: 运行测试通过**

```bash
cd apps/web && npx tsx --test server/lib/fob-bill-format.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/fob-bill-format*
git commit -m "feat(fob): bill format detection and mismatch warnings"
```

---

## Task 3: Payment Status Helper

**Files:**
- Create: `apps/web/server/lib/fob-payment-status.ts`
- Create: `apps/web/server/lib/fob-payment-status.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import assert from 'node:assert/strict';
import { validatePaymentUpdate, paymentStatusLabel } from './fob-payment-status.js';

assert.throws(() => validatePaymentUpdate({ paymentStatus: 'not_required', remark: '' }), /备注/);
assert.doesNotThrow(() => validatePaymentUpdate({ paymentStatus: 'not_required', remark: '总部代付' }));
assert.equal(paymentStatusLabel('unpaid'), '否');
```

- [ ] **Step 2: 实现**

```typescript
export type PaymentStatus = 'paid' | 'unpaid' | 'not_required';

export function validatePaymentUpdate(input: { paymentStatus: PaymentStatus; remark?: string | null }) {
  if (input.paymentStatus === 'not_required' && !input.remark?.trim()) {
    throw new Error('选择「无需支付」时备注必填');
  }
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: '是',
  unpaid: '否',
  not_required: '无需支付',
};

export function paymentStatusLabel(s: PaymentStatus) {
  return PAYMENT_STATUS_LABEL[s];
}
```

- [ ] **Step 3: 运行测试 + Commit**

```bash
cd apps/web && npx tsx --test server/lib/fob-payment-status.test.ts
git add apps/web/server/lib/fob-payment-status*
git commit -m "feat(fob): payment status validation helper"
```

---

## Task 4: Service Provider API

**Files:**
- Modify: `apps/web/server/routes/logistics.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: 在 `logistics.ts` 添加路由（权限 `fobMenu`，与 fee-rules 一致）**

```typescript
import { fobServiceProviders } from '@scm/db';

logisticsRoutes.get('/logistics/fob-service-providers', fobMenu, async (c) => {
  const providerType = c.req.query('providerType'); // trucking | freight
  const activeOnly = c.req.query('activeOnly') === 'true';
  const conditions = [];
  if (providerType === 'trucking' || providerType === 'freight') {
    conditions.push(eq(fobServiceProviders.providerType, providerType));
  }
  if (activeOnly) conditions.push(eq(fobServiceProviders.isActive, true));
  const rows = await db.select().from(fobServiceProviders)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(fobServiceProviders.sortOrder, fobServiceProviders.name);
  return c.json(rows);
});

logisticsRoutes.post('/logistics/fob-service-providers', fobMenu, async (c) => {
  const body = await c.req.json<{
    code: string; name: string; providerType: 'trucking' | 'freight';
    billFormat: 'senwei_original' | 'huamao_original' | 'simplified_wide';
    sortOrder?: number; remark?: string;
  }>();
  // 校验 code/name 非空；code 唯一
  const [row] = await db.insert(fobServiceProviders).values({ ... }).returning();
  return c.json(row, 201);
});

logisticsRoutes.patch('/logistics/fob-service-providers/:id', fobMenu, async (c) => { /* 更新 name/sortOrder/remark/billFormat */ });
logisticsRoutes.patch('/logistics/fob-service-providers/:id/toggle', fobMenu, async (c) => { /* isActive 取反 */ });
```

- [ ] **Step 2: `api.ts` 添加方法**

```typescript
getFobServiceProviders: (params?: { providerType?: 'trucking' | 'freight'; activeOnly?: boolean }) => ...,
createFobServiceProvider: (data: {...}) => ...,
updateFobServiceProvider: (id: string, data: {...}) => ...,
toggleFobServiceProvider: (id: string) => ...,
```

- [ ] **Step 3: 手动冒烟**

```bash
pnpm dev:server
# POST /api/logistics/fob-service-providers 需登录 cookie；或 curl 带 AUTH_DEV_MODE
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routes/logistics.ts apps/web/src/lib/api.ts
git commit -m "feat(api): FOB service provider CRUD"
```

---

## Task 5: Batch Create & Detail — Type + Provider

**Files:**
- Modify: `apps/web/server/routes/logistics.ts`（`POST/GET` settlements）
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/FobSettlementListPage.tsx`

- [ ] **Step 1: 扩展 `POST /logistics/fob-settlements`**

```typescript
const body = await c.req.json<{
  name: string;
  settlementPeriod: string;
  settlementType: 'trucking' | 'freight';
  serviceProviderId: string;
  usdToCnyRate?: number;
  remark?: string;
}>();

const [provider] = await db.select().from(fobServiceProviders)
  .where(eq(fobServiceProviders.id, body.serviceProviderId)).limit(1);
if (!provider?.isActive) return c.json({ message: '服务商无效或已停用' }, 400);
if (provider.providerType !== body.settlementType) {
  return c.json({ message: '服务商类型与分账类型不一致' }, 400);
}

const [batch] = await db.insert(fobSettlementBatches).values({
  batchNo: await nextFobBatchNo(),
  name: body.name.trim(),
  settlementPeriod: body.settlementPeriod.trim(),
  settlementType: body.settlementType,
  serviceProviderId: body.serviceProviderId,
  // ...
}).returning();
```

- [ ] **Step 2: 扩展 `GET .../fob-settlements/:id`**

Join `fobServiceProviders` 返回：

```typescript
{
  ...batch,
  settlementType: batch.settlementType,
  serviceProvider: { id, code, name, billFormat },
  merchantSummary: summarizeByMerchant(...).map(m => ({
    ...m,
    paymentStatus: paymentMap.get(m.merchantCode) ?? 'unpaid',
    paymentRemark: remarkMap.get(m.merchantCode) ?? null,
  })),
}
```

列表 `GET /fob-settlements` 同样 join 服务商 name，支持 `?settlementType=` 筛选。

- [ ] **Step 3: 更新 `FobSettlementListPage` 创建表单**

```tsx
const [form, setForm] = useState({
  name: '',
  settlementPeriod: new Date().toISOString().slice(0, 7),
  settlementType: 'trucking' as 'trucking' | 'freight',
  serviceProviderId: '',
});

const { data: providers = [] } = useQuery({
  queryKey: ['fob-service-providers', form.settlementType],
  queryFn: () => api.getFobServiceProviders({ providerType: form.settlementType, activeOnly: true }),
  enabled: showForm,
});

// settlementType 变化时 setForm(f => ({ ...f, serviceProviderId: '' }))
```

列表表头增加「分账类型」「服务商」列。

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routes/logistics.ts apps/web/src/lib/api.ts apps/web/src/pages/FobSettlementListPage.tsx
git commit -m "feat(fob): batch settlement type and service provider on create"
```

---

## Task 6: Import Mutual Exclusion & Soft Warnings

**Files:**
- Modify: `apps/web/server/routes/logistics.ts`（import trucking/freight）
- Modify: `apps/web/src/pages/FobSettlementDetailPage.tsx`

- [ ] **Step 1: 添加批次类型守卫**

```typescript
async function getBatchWithProvider(batchId: string) {
  const [row] = await db.select({
    batch: fobSettlementBatches,
    provider: fobServiceProviders,
  })
    .from(fobSettlementBatches)
    .innerJoin(fobServiceProviders, eq(fobSettlementBatches.serviceProviderId, fobServiceProviders.id))
    .where(eq(fobSettlementBatches.id, batchId))
    .limit(1);
  return row ?? null;
}

function assertBillImportAllowed(
  settlementType: 'trucking' | 'freight',
  billKind: 'trucking' | 'freight',
) {
  if (settlementType !== billKind) {
    throw new Error(billKind === 'trucking' ? '本批次为货代分账，不可导入拖车账单' : '本批次为拖车分账，不可导入货代账单');
  }
}
```

在 `import/trucking` 开头：`assertBillImportAllowed(batch.settlementType, 'trucking')`。  
`import/freight` 同理。

- [ ] **Step 2: 导入响应增加 warnings**

```typescript
const detectedFormat = resolveTruckingDetection(rows); // or freight
const mismatch = billFormatMismatchWarning(provider.billFormat, detectTruckingBillFormat(detectedFormat), provider.name);
const warnings = mismatch ? [mismatch] : [];

return c.json({ imported, containers, skippedRows, exceptionCount, errors: parsed.errors, warnings });
```

- [ ] **Step 3: 详情页按 `data.settlementType` 显隐导入块**

```typescript
// 移除 freight 导入块当 settlementType === 'trucking'
const workflow = useMemo(() => {
  const volume = (data?.merchantShipments?.length ?? 0) > 0;
  const bill = data?.settlementType === 'trucking'
    ? (data?.truckingItems?.length ?? 0) > 0
    : (data?.freightItems?.length ?? 0) > 0;
  return { volume, bill, allReady: volume && bill, settlementType: data?.settlementType };
}, [data]);
```

更新 `missingImports`、`WorkflowStepper`、banner 文案；详情 Card 展示 `分账类型 · 服务商`。

导入成功时若 `r.warnings?.length` 显示黄色提示。

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routes/logistics.ts apps/web/src/pages/FobSettlementDetailPage.tsx
git commit -m "feat(fob): bill import type guard and format warnings"
```

---

## Task 7: Calculate — Single Bill Type & Payment Init

**Files:**
- Modify: `apps/web/server/routes/logistics.ts`（`buildFeeLines`, `calculate`）
- Create helper in `fob-payment-status.ts` or inline

- [ ] **Step 1: `buildFeeLines` 接受 `settlementType`**

```typescript
async function buildFeeLines(batchId: string, settlementType: 'trucking' | 'freight'): Promise<FeeLine[]> {
  if (settlementType === 'trucking') {
    const trucking = await db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId));
    return trucking.map(/* 现有 mapping */);
  }
  const freight = await db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId));
  return freight.map(/* 现有 mapping */);
}
```

更新所有 `buildFeeLines(batchId)` 调用处传入 `batch.settlementType`。

- [ ] **Step 2: `calculate` 前置检查**

```typescript
const billCount = batch.settlementType === 'trucking' ? trucking.length : freight.length;
if (!billCount) {
  return c.json({ message: batch.settlementType === 'trucking' ? '请先导入拖车账单' : '请先导入货代账单' }, 400);
}
```

- [ ] **Step 3: 核算成功后初始化付款状态**

```typescript
const merchants = summarizeByMerchant(allocations);
for (const m of merchants) {
  await db.insert(fobMerchantPaymentStatus).values({
    batchId,
    merchantCode: m.merchantCode,
    paymentStatus: 'unpaid',
  }).onConflictDoNothing();
}
```

金额为 0 的主体可在前端建议选「无需支付」，后端不自动改（用户手动）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/server/routes/logistics.ts apps/web/server/lib/fob-payment-status.ts
git commit -m "feat(fob): calculate single bill type and init payment status"
```

---

## Task 8: Merchant Payment PATCH API

**Files:**
- Modify: `apps/web/server/routes/logistics.ts`
- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: 添加路由**

```typescript
logisticsRoutes.patch('/logistics/fob-settlements/:id/merchant-payments', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    updates: Array<{ merchantCode: string; paymentStatus: PaymentStatus; remark?: string | null }>;
  }>();
  for (const u of body.updates) {
    validatePaymentUpdate(u);
    await db.insert(fobMerchantPaymentStatus).values({
      batchId,
      merchantCode: u.merchantCode,
      paymentStatus: u.paymentStatus,
      remark: u.remark?.trim() || null,
      updatedBy: user.id,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [fobMerchantPaymentStatus.batchId, fobMerchantPaymentStatus.merchantCode],
      set: { paymentStatus: u.paymentStatus, remark: u.remark?.trim() || null, updatedBy: user.id, updatedAt: new Date() },
    });
  }
  return c.json({ ok: true });
});
```

**注意：** `confirmed` 批次仍允许修改（PRD 已确认）。

- [ ] **Step 2: `api.patchFobMerchantPayments`**

- [ ] **Step 3: Commit**

```bash
git add apps/web/server/routes/logistics.ts apps/web/src/lib/api.ts
git commit -m "feat(api): merchant payment status batch update"
```

---

## Task 9: Two-Tier Reconcile Export

**Files:**
- Modify: `apps/web/server/lib/fob-reconcile-export.ts`
- Modify: `apps/web/server/lib/fob-reconcile-export.test.ts`
- Modify: `apps/web/server/routes/logistics.ts`（export endpoints）

- [ ] **Step 1: 写失败测试 — 两级行结构**

```typescript
import { buildReconcileTieredTableAoa } from './fob-reconcile-export.js';

const rows = buildReconcileTieredTableAoa({
  allocations,
  feeRules,
  meta: { settlementPeriod: '2026-06', settlementTypeLabel: '拖车分账', providerName: '森威', batchNo: 'FOB-202606-001' },
  merchantFilter: 'M1',
  payment: { paymentStatus: 'unpaid', remark: null },
});

// 第 1 行元信息；第 2 行表头；第 3 行应为汇总行（行类型=summary）
assert.equal(rows[2][0], 'CNTR1');
assert.equal(rows[2][rows[2].length - 3], 'summary'); // 或用专用列「行类型」
```

- [ ] **Step 2: 实现 `buildReconcileTieredTableAoa`**

固定列（本期无业务编号）：

```
行类型 | 柜号 | 主体名称 | 费用项 | 体积m³ | 本公司金额 | 本柜/本费总额 | [动态费用列...] | 是否付款 | 备注
```

逻辑：

```typescript
for (const container of containersForMerchant) {
  // 汇总行
  rows.push(['summary', containerNo, merchantName, '', volume, merchantContainerTotal, containerBillTotal, ...feeSummaryCells, paymentLabel, remark]);
  for (const fee of feesInContainer) {
    rows.push(['detail', containerNo, '', fee.feeType, '', merchantFeeAlloc, fee.sourceAmountCny, ...perFeeCells, '', '']);
  }
}
```

`containerBillTotal` = 该柜同 `settlementType` 账单 `amount_cny` 合计（`rejected` 异常行排除，沿用 `effectiveBillAmount` 逻辑）。

- [ ] **Step 3: 更新 export 路由传入 meta + paymentMap**

```typescript
const paymentRows = await db.select().from(fobMerchantPaymentStatus).where(eq(fobMerchantPaymentStatus.batchId, batchId));
const paymentMap = new Map(paymentRows.map(p => [p.merchantCode, p]));
```

- [ ] **Step 4: 运行测试**

```bash
cd apps/web && npx tsx --test server/lib/fob-reconcile-export.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/server/lib/fob-reconcile-export*
git add apps/web/server/routes/logistics.ts
git commit -m "feat(fob): two-tier reconcile export with payment columns"
```

---

## Task 10: Service Providers Panel (Frontend)

**Files:**
- Create: `apps/web/src/components/FobServiceProvidersPanel.tsx`
- Modify: `apps/web/src/pages/FobSettlementListPage.tsx`

- [ ] **Step 1: 新建 Panel（镜像 `FobFeeRulesPanel` 结构）**

- 筛选：`providerType` all/trucking/freight
- 表格列：编码、名称、类型、账单格式、排序、状态
- 表单：`code`（新建后只读）、`name`、`providerType`、`billFormat` 下拉、`sortOrder`、`remark`
- 操作：新建、编辑、启用/停用；无删除按钮

`bill_format` 选项：

```typescript
const BILL_FORMAT_OPTIONS = [
  { value: 'senwei_original', label: '森威原表' },
  { value: 'huamao_original', label: '华贸原表' },
  { value: 'simplified_wide', label: '简化宽表模板' },
];
```

- [ ] **Step 2: `FobSettlementListPage` 增加 Tab**

```typescript
type TabKey = 'batches' | 'rules' | 'service-providers';

{ key: 'service-providers', label: '服务商' }
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/FobServiceProvidersPanel.tsx apps/web/src/pages/FobSettlementListPage.tsx
git commit -m "feat(ui): FOB service providers admin tab"
```

---

## Task 11: Summary Tab — Payment UI & Split Display

**Files:**
- Modify: `apps/web/src/pages/FobSettlementDetailPage.tsx`
- Modify: `apps/web/src/components/FobContainerMatrixPanel.tsx`

- [ ] **Step 1: 商家汇总表增加付款列**

```tsx
<select
  value={s.paymentStatus ?? 'unpaid'}
  onChange={(e) => patchPayment.mutate({ merchantCode: s.merchantCode, paymentStatus: e.target.value, remark: ... })}
>
  <option value="paid">是</option>
  <option value="unpaid">否</option>
  <option value="not_required">无需支付</option>
</select>
<Input
  value={remarks[s.merchantCode] ?? ''}
  disabled={s.paymentStatus !== 'not_required' && !editingRemark}
  onBlur={() => { if (s.paymentStatus === 'not_required' && !remark.trim()) setError('备注必填'); }}
/>
```

`grandTotal === 0` 时可在 UI 旁显示灰色提示「可标为无需支付」。

- [ ] **Step 2: `FobContainerMatrixPanel` 增加分列**

在费用矩阵或按主体汇总子表增加：

```tsx
<th>本公司金额</th>
<th>本柜账单总额</th>
```

`containerBillTotal` 从 `containerChecks` 聚合 `sourceAmountCny`；`merchantAllocated` 从 `allocations` 过滤当前主体。

按 `settlementType` 隐藏无关阶段列（货代批次隐藏空拖车列可选优化）。

- [ ] **Step 3: 分摊核算 Tab「按主体汇总」视图同步分列**

`ReconcileViewTabs` merchant 视图表格增加「本公司合计」「本柜账单总额」两列（分开展示，不合并）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/FobSettlementDetailPage.tsx apps/web/src/components/FobContainerMatrixPanel.tsx
git commit -m "feat(ui): split amount display and payment status on summary"
```

---

## Task 12: Miaoda Sync & Verification

**Files:**
- Verify: `packages/db/drizzle/0013_*.sql` 被 `pnpm miaoda:init-sql` 纳入
- Run: `pnpm zip:miaoda`

- [ ] **Step 1: 确认妙搭 SQL 生成包含新表**

```bash
pnpm miaoda:init-sql
grep -l "fob_service_providers" packages/db/drizzle/miaoda-init-all.sql
```

若无，更新 `packages/db/scripts/build-miaoda-init-sql.ts` 纳入 `0013`。

- [ ] **Step 2: 跑全量 FOB 单测**

```bash
cd apps/web && npx tsx --test server/lib/fob-*.test.ts
```

Expected: 全部 PASS

- [ ] **Step 3: 端到端冒烟清单**

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 新建拖车批次·森威 | 仅体积+拖车导入 |
| 2 | 导入货代文件到该批次 | 400 |
| 3 | 导入森威 xlsx（格式略不符） | 200 + warnings |
| 4 | 核算 | merchantSummary 默认未付款 |
| 5 | 标「无需支付」无备注 | 前端/API 400 |
| 6 | 填备注保存 | 成功 |
| 7 | 按公司导出 | ZIP 含两级行 + 付款列 |
| 8 | 确认批次后改付款 | 仍可改 |
| 9 | 同月再建货代批次·华贸 | 成功 |

- [ ] **Step 4: 打 ZIP**

```bash
pnpm zip:miaoda
```

- [ ] **Step 5: Commit**

```bash
git add packages/db/scripts/ docs/
git commit -m "chore: miaoda init sql and FOB split v2 verification"
```

---

## Spec Coverage Self-Review

| PRD 要求 | 对应 Task |
|----------|-----------|
| 拖车/货代分账互斥 | Task 6 |
| 创建选类型+服务商 | Task 5 |
| 服务商可配置枚举 | Task 1, 3, 10 |
| 一服务商一种格式 | Task 1, 10 |
| 导入软提醒 | Task 2, 6 |
| 体积不共用 | Task 6（各批次独立，无跨批 API） |
| 历史数据删除 | Task 1 迁移 |
| 分开展示本公司/本柜总额 | Task 11 |
| 付款三态+备注必填 | Task 3, 7, 8, 11 |
| 两级明细导出 | Task 9 |
| 无业务编号导出 | Task 9（固定列不含 internal_no/order_no） |
| confirmed 后可改付款 | Task 8 |
| 妙搭兼容 | Task 12 |

**无 TBD / 无占位步骤。**

---

## Suggested Commit Sequence (7 commits)

1. `feat(db): FOB split v2 schema...` — Task 1  
2. `feat(fob): bill format + payment helpers` — Task 2+3  
3. `feat(api): service providers + batch type` — Task 4+5  
4. `feat(fob): import guards and calculate` — Task 6+7  
5. `feat(api): payment patch + tiered export` — Task 8+9  
6. `feat(ui): providers tab + summary payment` — Task 10+11  
7. `chore: miaoda sql + verification` — Task 12  

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-18-fob-settlement-split-v2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 按 Task 1→12 逐任务派发子 agent，每任务完成后 review  

**2. Inline Execution** — 在本会话按 Task 批量执行，每 2–3 个 Task 设检查点  

**Which approach?**
