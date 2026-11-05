# 周需求计划矩阵 × 月销量预测 能力对齐

**版本**：v1.1（2026-11-04）  
**关联**：[2026-11-04-weekly-demand-sales-lag-design.md](./2026-11-04-weekly-demand-sales-lag-design.md)、[2026-09-22-planning-horizon-weekly-monthly-design.md](./2026-09-22-planning-horizon-weekly-monthly-design.md)

## 1. 产品约束

| 项 | 决策 |
|----|------|
| 产品定位 | **周度销量预测**；发布冻结版本；**补货链路暂未接入**（采用位可登记，不改变现行补货计算） |
| 周计划存储 | `demand_plan_weekly` **仅全平台合计一行**；可选 `blend_meta`（U / weekIndex / 混合权重） |
| Champion 绑定 | 生成写入 `demand_plan_versions.champion_forecast_version_id` + `generation_meta`；发布后冻结 |
| 分平台展示 | 读路径按已发布月预测形状拆分（`splitMergedWeeklyDailyByPlatform`） |
| 校准导入 | 分平台 CSV → 按月形状权重 **反算合计** `manual_daily_avg`（`mergePlatformCalibrations`）；亦可明细导入「全平台」行 |
| 月粒度需求计划 | **不改造**；周因子抽屉仅用于周版本 |
| 算法 | 不移植 V4.1 重算 / Dify / 季节重建到周计划生成 |

## 2. 矩阵能力对照

| 能力 | 月销量预测 | 周需求计划 |
|------|------------|------------|
| 宽表 / 明细 | 有 | 有（宽表 / 长表） |
| 合计 / 分平台 | 有 | 有（分平台为 enrich） |
| T 分层列 + 筛选 | 有 | 有（来自已发布预测 meta） |
| 多 SKU / 品类 / 商品范围 | 有 | 有（对齐筛选 query） |
| 平台多选展开 | 有 | 有 |
| 待校准（T99）快捷 | 有 | 有 |
| 导出宽表 / 明细 / 校准表 | 有 | 有（周列 `YYYY-Www`） |
| 导入校准 + 撤销 | 有（分平台落库） | 有（写入合计行） |
| 准确度导出 | Walk-forward WMAPE | 计划周 vs 实销日均 CSV + 页内准确度 Tab |
| 发布复核摘要 | review items | `GET .../review-summary`（T99 / 无 champion / skip） |
| 历史矩阵 / 因子明细导出 | 有 | **不做**（SKU 详情抽屉看；含 blend_meta） |
| 分平台 manual 落库 | 有 | **不做** |
| 冻结窗 | 有 | **暂不做** |

## 3. 校准导入语义

1. 运营在 **分平台** 视图导出校准表，改单元格生效日均后导入。  
2. 同一 SKU × ISO 周下，各平台校准值按 `splitMergedWeeklyDailyByPlatform` 的系统权重加权平均，写入 `demand_plan_weekly.manual_daily_avg`。  
3. 与系统合计日均四舍五入一致则跳过；空单元格跳过。  
4. 不可同时导入同一 SKU/周的「全平台」行与分平台行。  
5. 「撤销全部校准」清空该草稿版本全部周行的 `manual_daily_avg` / `adjust_reason`。

## 4. API 一览（周版本）

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/demand-plans/:id` | 矩阵 + `championForecastVersion` |
| GET | `/api/demand-plans/:id/sku-detail` | `skuId` + 可选 `platform` / `station` |
| GET | `/api/demand-plans/horizon/export` | `mode=wide\|detail\|calibration` |
| GET | `/api/demand-plans/:id/accuracy/export` | 计划 vs 实销 CSV |
| GET | `/api/demand-plans/:id/accuracy/summary` | 页内 SKU 级 MAE/WMAPE |
| GET | `/api/demand-plans/:id/review-summary` | 发布复核摘要 |
| POST | `/api/demand-plans/:id/calibration-import/preview\|commit` | 校准导入 |
| POST | `/api/demand-plans/:id/calibration-clear/preview\|commit` | 撤销校准 |

深链：`/data/demand-plan/:id?view=review&calibrationImport=1`；准确度 `?view=accuracy`

## 5. QA 验收清单

- [ ] 合计 / 分平台切换；分平台多选平台后行数变化正确  
- [ ] T 分层筛选与「待校准（T99）」结果一致  
- [ ] 多 SKU、品类、商品范围（配件）筛选生效；导出与列表筛选一致  
- [ ] 导出宽表 / 明细 / 校准表（校准须分平台）；导入预览 → 提交 → 宽表人工色  
- [ ] 撤销全部校准后人工列清空  
- [ ] 长表单条保存人工日均（草稿）  
- [ ] `calibrationImport=1` 深链打开导入弹窗  
- [ ] 导出准确度 / 准确度 Tab：历史开始周版本中有实销的周有绝对误差  
- [ ] 分平台点 SKU，抽屉渠道与列表一致  
- [ ] 复核摘要展示 T99 / 无 champion / 生成 skip  
- [ ] UI 标明补货暂未接入；采用仅登记意图  

发布验证菜单：`data.demand_plan`（见 [local-server-release-sop.md](../../local-server-release-sop.md)）。
