# 商品主数据 PRD

## 1. 需求分析

### 背景
跨境供应链各模块（库存、PMC 计划、补货、采购、合规）均依赖 SKU 与供货商家信息。MVP 阶段 SKU 与商家以冗余字段存储，无法支撑多商家供货、SPU 款式管理与跨境合规属性维护。

### 用户角色

| 角色 | 权限 | 典型操作 |
|------|------|----------|
| 采购员 | 读写商家、SKU 供货关系 | 维护默认供应商、价格/交期 |
| PMC 计划员 | 读 SKU/商家 | 创建计划时选择商家 |
| 管理员 | 全部 | SPU/SKU/商家 CRUD |
| 合规专员 | 读写合规属性 | 维护 HS 编码、重量尺寸 |

### 用户故事
- 作为采购员，我希望一个 SKU 关联多个商家并指定默认供货方，以便询比价与 PMC 合并计划
- 作为计划员，我希望 SKU 归属 SPU 款式，以便同系列多规格统一管理
- 作为合规专员，我希望维护 SKU 跨境属性，以便后续报关 Agent 使用

---

## 2. 数据模型

### 表：spus（款式/SPU）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | ✅ | ✅ | 主键 |
| code | varchar(100) | ✅ | ✅ | SPU 编号 |
| name | varchar(200) | ✅ | | 商品名称 |
| category | varchar(100) | | | 品类 |
| brand | varchar(100) | | | 品牌 |
| description | text | | | 描述 |
| is_active | boolean | ✅ | | 是否启用 |
| created_at | timestamptz | ✅ | | |
| updated_at | timestamptz | ✅ | | |

### 表：merchants（商家/供应商）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | ✅ | ✅ | 主键 |
| code | varchar(100) | ✅ | ✅ | 商家编号 |
| name | varchar(200) | ✅ | | 商家名称 |
| contact_name | varchar(100) | | | 联系人 |
| contact_phone | varchar(50) | | | 电话 |
| contact_email | varchar(200) | | | 邮箱 |
| country_code | varchar(2) | | | ISO 国家码 |
| payment_terms | varchar(100) | | | 账期条款 |
| remark | text | | | 备注 |
| is_active | boolean | ✅ | | |
| created_at / updated_at | timestamptz | ✅ | | |

### 表：skus（扩展）

| 新增字段 | 类型 | 说明 |
|----------|------|------|
| spu_id | uuid FK | 关联 spus.id |
| spec_attrs | jsonb | 规格属性 `{ color, size }` |
| barcode | varchar(100) | 条码 |

保留 `merchant_code` / `merchant_name` 为冗余字段，由 `sku_suppliers.is_default=true` 同步，兼容 PMC/补货逻辑。

### 表：sku_suppliers（SKU 供货关系）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | ✅ | ✅ | 主键 |
| sku_id | uuid | ✅ | ✦组合 | FK → skus |
| merchant_id | uuid | ✅ | ✦组合 | FK → merchants |
| unit_price | numeric(12,4) | | | 供货价 |
| lead_time_days | int | | | 交期 |
| moq | int | | | 起订量 |
| is_default | boolean | ✅ | | 是否默认供货方 |
| is_active | boolean | ✅ | | |

**唯一约束**：`(sku_id, merchant_id)`

### 表：sku_compliance（跨境合规，1:1 SKU）

| 字段 | 类型 | 说明 |
|------|------|------|
| sku_id | uuid FK ✦唯一 | |
| hs_code | varchar(20) | 海关编码 |
| origin_country | varchar(2) | 原产国 |
| declared_value | numeric | 申报价值 |
| weight_kg | numeric | 重量 |
| length_cm / width_cm / height_cm | numeric | 尺寸 |
| battery_type | varchar(50) | 电池类型 |
| is_liquid | boolean | 是否液体 |

### 关系

```
spus 1 ── N skus
merchants 1 ── N sku_suppliers N ── 1 skus
skus 1 ── 1 sku_compliance
```

### 索引

- `spus(category)`
- `skus(spu_id)`
- `sku_suppliers(sku_id)`, `sku_suppliers(merchant_id)`

---

## 3. 页面流程

### 页面清单

| 页面 | 路由 | 功能 |
|------|------|------|
| 商品主数据 | /data/products | SPU / SKU / 商家 Tab 列表与新建 |
| 数据导入 | /data/import?type=skus | CSV 导入，支持 spu_code |

### 流程

[商品主数据] → Tab 切换 → 填写表单 → 保存 → 列表刷新

SKU 新建时若填写商家编号，自动创建 `sku_suppliers` 并同步默认商家到 SKU 冗余字段。

---

## 4. 业务逻辑

### 默认供货商家同步

1. `sku_suppliers` 中 `is_default=true` 的记录变更时
2. 将对应 `merchants.code/name` 及 price/lead_time/moq 写入 `skus` 冗余字段
3. PMC 计划、补货建议继续读 `skus.merchant_code`（零改动兼容）

### 数据迁移（存量）

1. 从 `skus.merchant_code` 去重生成 `merchants`
2. 每个 SKU 按 code 生成过渡 SPU（1:1，后续可合并）
3. 回填 `sku_suppliers` 默认供货关系

### 导入规则

- `spu_code` 为空时，以 `sku_code` 作为 SPU 编号自动建 SPU
- `merchant_code` 不存在时自动创建商家主数据

---

## 5. API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/spus | SPU 列表 |
| POST | /api/spus | 新建 SPU |
| GET | /api/merchants/master | 商家主数据列表 |
| POST | /api/merchants | 新建商家 |
| GET | /api/products/sku-overview | SKU 概览（含 SPU、默认商家） |
| GET | /api/skus/:id/suppliers | SKU 供货关系 |
| POST | /api/skus/:id/suppliers | 添加/更新供货关系 |
| PUT | /api/sku-suppliers/:id/default | 设为默认供货方 |
| PUT | /api/skus/:id/compliance | 保存合规属性 |

`/api/merchants` 优先读 `merchants` 表，空表时回退 SKU 去重（兼容未迁移环境）。

---

## 6. 集成

- **PMC / 补货**：继续消费 `skus.merchant_code`（同步字段）
- **Phase 2 采购 Agent**：读 `sku_suppliers` 多商家比价
- **Phase 2 合规 Agent**：读 `sku_compliance`
