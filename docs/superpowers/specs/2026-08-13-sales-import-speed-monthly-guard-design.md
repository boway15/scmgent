# 销量导入加速 + 月表残月保护

> **状态**：已实现  
> **日期**：2026-08-13  
> **背景**：日表 365 天裁剪后再次导入/重聚合，会用残月日表覆盖月表（2025-08 少 41,323）；全量宽表导入需 1～2 小时。

---

## 1. 目标

| 目标 | 结论 |
|------|------|
| 残月不覆盖 | 日表最早日期晚于该月 1 号时，**不更新**该月月表 |
| 导入加速 | 同样 3 万 SKU 日宽表，从 1～2 小时降到大约 **10～20 分钟**（视机器负载） |
| 修已坏数据 | 上线后 **再导一次同一份宽表**（不必清空）；补回裁掉的日行 → 整月聚合 → 再裁日表 |
| 不改口径 | 日表唯一键、`ON CONFLICT DO NOTHING`、月表维度 `(sku, channel, year, month)` 不变 |

### 非范围

- 不改用 Postgres `COPY` 重写导入管线
- 不恢复月宽表单独导入
- 不把日表保留天数从 365 改掉
- 不在本迭代做导入进度 UI 大改

---

## 2. 残月判定

以当前聚合查询范围内日表 `MIN(sale_date)` 为 `dailyMin`。

日历月 `YYYY-MM-01` **严格小于** `dailyMin` → 该月日表明细不完整（前几天已被裁剪）→ **跳过 upsert**。

| 场景 | dailyMin | 2025-08 | 2025-09 | 当月 |
|------|----------|---------|---------|------|
| 全量导入、裁剪前 | 2024-01-01 | 更新 | 更新 | 更新 |
| 裁剪后（2026-08-13） | 2025-08-13 | **跳过** | 更新 | 更新 |
| 补回 8/1 后再聚合 | 2025-08-01 | 更新（整月） | 更新 | 更新 |

当月未结束仍更新（`YYYY-MM-01 >= dailyMin`）。

纯函数：`shouldAggregateCalendarMonth(year, month, dailyMinDate)`。

---

## 3. 月表聚合实现

`aggregateSalesHistoryMonthlyFromDaily`：

1. 沿用现有 lookback / skuIds 过滤  
2. 同一过滤下取 `dailyMin`  
3. 一条 `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE`，并加 `make_date(year,month,1) >= dailyMin`  
4. `category` 从 `skus` join，不再 JS 逐行 `loadSkuCategoryMap` + 逐行 insert  

`runSalesHistoryMaintenance`、导入结束聚合、预测「重算月表」接口共用此函数，自动获得残月保护。

---

## 4. 导入加速

| 点 | 现状 | 改为 |
|----|------|------|
| 宽表 SKU 分片 | 25 | **保持 25**（200 会堵死同进程 HTTP；加速靠 SKU 批量查找与月表 SQL） |
| SKU 解析 | 每码 `ensureSpu` + `select` | 先 `parseSkuCode` 归一化，再 `code IN (...)` 分批 500 命中；仅缺失码走 `ensureSkuFromImport` |
| 日表 insert | 1000 行 + `RETURNING id` | **2000** 行；仍 `ON CONFLICT DO NOTHING`；用 `RETURNING` 计插入数（保持跳过统计） |
| 月表 upsert | 十万次逐行 | 见 §3 一条 SQL |

冲突策略不变：已存在 `(sku, date, channel, station)` **不覆盖**。

---

## 5. 已坏 2025-08 的修复步骤（运维）

代码上线后：

1. 再上传同一份「产品销售报表-每日」宽表（或临时 `SALES_IMPORT_MIN_DATE=2025-08-01` 只展开近一年）  
2. 导入会插入已裁掉的 8/1–8/12 → 聚合时 8 月完整 → 写入月表  
3. 随后日表再裁剪；以后导入因残月保护 **不再覆盖 8 月**

不要在日表已裁、8/1–8/12 尚未补回时手动点「月表全量重聚合」。

---

## 6. 测试

- `shouldAggregateCalendarMonth`：`dailyMin=2025-08-13` 时 8 月 false、9 月 true；`dailyMin=null` false  
- `SALES_WIDE_IMPORT_CHUNK_SIZE === 25`（与 HTTP 同进程，不可再加大）  
- SKU 查找分片：`chunkList` 边界（空、整除、余数）  
- 现有 xiaoshou / sales-history-import 单测仍通过  

---

## 7. 风险

- 分片 200 在日期列极多且全为正销量时内存升高；Docker 已 `max-old-space-size=4096`，可接受；若 OOM 再降到 100  
- 大批 `skuIds` 的 `IN` 列表需分批执行月聚合 SQL（建议 2000）  
