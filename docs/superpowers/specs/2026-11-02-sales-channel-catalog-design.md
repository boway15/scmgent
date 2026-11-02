# 销售渠道目录统一

> **状态**：待实现  
> **日期**：2026-11-02  
> **决定**：源表已出现的平台全部单独预测；品牌站撤出下拉；未知档不再叠加 Shopify / eBay。

---

## 1. 背景与目标

飞书日销的「平台」里已有 Wayfair、Etsy、ManoMano、Real、OTTO、B2B小包、Shopify、eBay。复核矩阵的渠道下拉来自 `sales_platforms`，预测生成只写 `AMAZON`、`WALMART`、`TEMU`、`TIKTOK`、`UNKNOWN`。

导入热路径 `normalizeSalesPlatformSync` 只认静态别名。对不上的名字写成 `UNKNOWN`。因此 Wayfair 等有销量、矩阵里没有这一行。Shopify、eBay、品牌站在下拉里，预测行却不按它们落库，切过去是空表。算 `UNKNOWN` 时还会把 `SHOPIFY`、`DTC`、`EBAY` 再加进去（`FORECAST_UNKNOWN_BUCKET_CHANNELS`）。

| 目标 | 结论 |
|------|------|
| 一份目录 | `sales_platforms` + `sales_platform_aliases` 与静态别名表同一套码 |
| 源表平台单独预测 | 见第 2 节，全渠道等于这些码之和 |
| 其他 | 标准码仍为 `UNKNOWN`，显示名改为「其他」，只接未登记的新名字 |
| 品牌站 | `DTC` 停用，撤出下拉；「独立站」「品牌站」「DTC」作为别名指向 `SHOPIFY` |
| 历史 | 发布时清掉飞书覆盖期内的 `UNKNOWN` 日/月行，再整段重导；已发布预测版本不回写 |

### 非范围

- 不改站点国家分桶。`wayfair欧洲`、`Amazon比利时`、`manomano-France` 仍按现有 `normalizeStationFromReport` 结果落站点。
- 不改 V4.1 分层阈值。亚马逊继续走亚马逊门槛，其余平台走现有非亚马逊门槛（`NON_AMAZON_PLATFORMS`）。
- 不回写已发布 / 已归档预测版本。新渠道从下一次生成的版本起出现。
- 不改新闻情报里的平台标签。

---

## 2. 渠道目录

复核下拉只列 `is_active = true` 且 `code <> 'ALL'` 的平台，按 `sort_order`。空选项仍是「全渠道汇总」。

| code | 显示名 | sort | 别名（写入静态表与 `sales_platform_aliases`） | 预测分层 |
|------|--------|------|-----------------------------------------------|----------|
| `AMAZON` | 亚马逊 | 10 | 亚马逊、AMZ、AMAZON、AMAZON.COM、AMAZON US、AMAZON-US | 亚马逊 |
| `WALMART` | 沃尔玛 | 20 | 沃尔玛、WALMART、WM | 非亚马逊 |
| `WAYFAIR` | Wayfair | 30 | wayfair、WAYFAIR | 非亚马逊 |
| `TIKTOK` | TikTok Shop | 40 | Tiktok、TIKTOK、TT、TIK TOK、TIKTOK SHOP | 非亚马逊 |
| `TEMU` | Temu | 50 | TEMU、Temu | 非亚马逊 |
| `SHOPIFY` | Shopify | 60 | Shopify、SHOPIFY、独立站、品牌站、DTC | 非亚马逊 |
| `EBAY` | eBay | 70 | eBay、EBAY | 非亚马逊 |
| `ETSY` | Etsy | 80 | etsy、ETSY | 非亚马逊 |
| `MANOMANO` | ManoMano | 90 | manomano、MANOMANO | 非亚马逊 |
| `REAL` | Real | 100 | Real、REAL | 非亚马逊 |
| `OTTO` | OTTO | 110 | otto、OTTO | 非亚马逊 |
| `B2B` | B2B小包 | 120 | B2B、B2B小包 | 非亚马逊 |
| `UNKNOWN` | 其他 | 130 | 未知、UNKNOWN | 非亚马逊 |
| `DTC` | 品牌站 | — | 行保留，`is_active = false` | 不生成 |

飞书解析仍先从「站点」抽出原始名（`wayfair英国` → `wayfair`，`TEMU-US` → `TEMU`，`manomano-France` → `manomano`），再交给同一归一函数。Excel 宽表继续读「平台」列，走同一函数。

`SHOPIFY` 的显示名从「独立站」改为「Shopify」。现有别名「独立站」从 `DTC` 改为 `SHOPIFY`。

全渠道汇总 = 上表除 `DTC`、`ALL` 以外的全部有效码之和，包含 `UNKNOWN`。

---

## 3. 查询与预测口径

### 3.1 去掉未知档叠加

删除 `FORECAST_UNKNOWN_BUCKET_CHANNELS`（`SHOPIFY`、`DTC`、`EBAY` 并入 `UNKNOWN` 查询）及其调用。

- 筛「其他」只命中 `UNKNOWN` 与别名「未知」。
- 筛 Shopify 命中 `SHOPIFY` 及其别名，并命中历史行里仍为 `DTC` 的渠道，避免旧销量丢失。
- 筛 Wayfair / Etsy / ManoMano / Real / OTTO / B2B小包 只命中各自的码和别名。

### 3.2 预测生成

`FORECAST_V41_PLATFORM_CODES`（后端 `forecast-platform-scope.ts` 与前端 `forecast-horizon-meta.ts`）改为第 2 节全部有效码，顺序与 `sort_order` 一致：

`AMAZON`、`WALMART`、`WAYFAIR`、`TIKTOK`、`TEMU`、`SHOPIFY`、`EBAY`、`ETSY`、`MANOMANO`、`REAL`、`OTTO`、`B2B`、`UNKNOWN`。

`resolveBaselineForecastPlatforms('ALL')` 展开为这一列表。`NON_AMAZON_PLATFORMS` 加入除 `AMAZON` 以外的这些码。版本名里的平台中文名与第 2 节显示名一致（`UNKNOWN` 显示「其他」）。

各平台用该平台销量出数。不再把 Shopify、eBay 的训练销量算进「其他」。

### 3.3 下拉

`listActiveSalesPlatforms` 已按 `is_active` 过滤。停用 `DTC` 后，复核矩阵不再出现「品牌站」。「其他」因 `UNKNOWN` 行有效而出现。

---

## 4. 数据流

```
飞书站点 / Excel 平台
  → 原始名（现有 platformRawFromStation 或平台列）
  → normalizeSalesPlatformSync（静态别名）
  → sales_history.channel = 标准码
  → 预测生成按 FORECAST_V41_PLATFORM_CODES 分平台写入
  → 复核下拉读有效 sales_platforms
```

日销唯一键是 `(sku_id, sale_date, channel, station)`。渠道从 `UNKNOWN` 改成 `WAYFAIR` 会插入新行，旧 `UNKNOWN` 行仍在，同一天会算两次。月表唯一键是 `(sku_id, channel, sale_year, month)`，同样会留下旧的 `UNKNOWN` 月行。

---

## 5. 发布时的历史切换

与代码同一发布窗口完成，且发生在下一次预测生成之前。飞书同步拉取长表全部记录（`listAllRecords`），不是滚动近窗。

1. 先上别名与目录（新导入开始写 `WAYFAIR` 等标准码）。
2. 拉一次长表，记下其中付款日期的闭区间 `[min, max]`。长表里没有的更早日期不动。
3. 删除该区间内 `sales_history.channel = 'UNKNOWN'` 的行。
4. 月表由导入末尾的 `aggregateSalesHistoryMonthlyFromDaily` 从日表重算，默认回看 36 个月。只删除这 36 个月与 `[min, max]` 相交月份上的 `sales_history_monthly.channel = 'UNKNOWN'` 行，避免清掉长表覆盖不到的历史月销。
5. 立刻再跑一次飞书日销同步。未登记平台重新写成 `UNKNOWN`；Wayfair 等写成各自标准码；月表按日表重算写回。
6. 然后生成新的预测版本。已发布版本不改。

`SHOPIFY`、`EBAY` 的历史行本就是独立码，不删。`DTC` 历史行不改写，查询 Shopify 时纳入。

若第 5 步之前定时同步又写入了新的 `UNKNOWN`（其中混有尚未按新别名拆开的量），以第 3–5 步的最终一次为准：先删覆盖区间的 `UNKNOWN`，再同步。

---

## 6. 错误与边界

- 空平台、无法识别的新名字仍落 `UNKNOWN`，并继续走现有未知渠道占比告警（超过 5% 提示补别名）。
- `DTC` 停用后，原始名「DTC」「品牌站」「独立站」归一到 `SHOPIFY`，不再新建 `DTC` 行。
- 某平台对某 SKU 无销量时，复核矩阵该渠道为空。这是无销量，不是漏渠道。
- 旧预测版本没有新平台行。打开旧版本时，Wayfair 等渠道为空；全渠道汇总只加该版本实际写过的平台。

---

## 7. 测试

- `normalizeSalesPlatformSync`：`wayfair`、`Wayfair`、`etsy`、`manomano`、`Real`、`otto`、`B2B小包`、`B2B`、`独立站`、`品牌站`、`DTC`、`Shopify`、`eBay` 落到第 2 节的码；`未知平台XYZ` 仍为 `UNKNOWN`。
- `channelsForPlatformFilterSync('UNKNOWN')` 不含 `SHOPIFY`、`DTC`、`EBAY`、`WAYFAIR`。
- `channelsForPlatformFilterSync('SHOPIFY')` 含 `SHOPIFY`、`独立站`、`DTC`。
- `resolveBaselineForecastPlatforms('ALL')` 与第 3.2 节列表一致，且不含 `DTC`。
- 飞书映射样例保持：`wayfair` → 原始名 `wayfair`、站点 `US`；导入计划里的 `channel` 为 `WAYFAIR`。
- 全渠道生成平台数等于 13（第 3.2 节），不再把 Shopify 销量并进 `UNKNOWN` 的训练查询。

---

## 8. 改动落点

| 位置 | 改动 |
|------|------|
| 新 drizzle 迁移 | 插入新平台；更新 `SHOPIFY` 显示名与排序；停用 `DTC`；插入 `UNKNOWN`；改「独立站」别名并补新别名 |
| `sales-platform.ts` | 静态别名与第 2 节对齐；删除未知档叠加；Shopify 查询纳入 `DTC` |
| `forecast-platform-scope.ts`、`forecast-horizon-meta.ts` | 扩展预测平台列表 |
| `forecast-allcat-v41.ts` | `NON_AMAZON_PLATFORMS` 补新码 |
| `forecast-demand.ts`、`forecast-version-label.ts` | 别名与「其他」显示名 |
| `sales-platform.test.ts`、预测平台范围测试、飞书导入计划测试 | 按第 7 节改断言 |
| 发布步骤 | 第 5 节的删除与重导，不做成应用启动时自动删数 |
