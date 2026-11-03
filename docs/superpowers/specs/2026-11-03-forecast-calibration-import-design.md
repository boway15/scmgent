# 预测校准 CSV 导入（v1）

## 背景

PMC 生成预测草稿 → 导出明细给运营确认 → 运营在 Excel 修改异议 SKU 的校准值后需写回系统。现仅有单条抽屉校准，无批量导入。

## 决策（已确认）

- 只写入 `manual_daily_avg` + `adjust_reason`，不覆盖 `forecast_daily_avg`
- 导入模板：「导出校准表/宽表」（宽表布局）或「导出明细」长表（推荐校准表宽表给运营）
- 校准列为空 → 跳过（不视为清除校准）
- 导入值与**系统预测**相同 → 跳过（不写 manual）；比较前双方按 **2 位小数**对齐（与导出 CSV 一致，避免精度误判）
- 导入值与系统预测不同 → 写入 manual + 备注
- 默认 `adjust_reason = 导入`；可选列「调整原因」覆盖
- 仅草稿版本可导入；`platform=全平台/ALL` 行拒绝（须分平台导出）
- 存在 blocking 错误时不可 commit

## 范围

- 后端：`forecast-calibration-import.ts` + preview/commit API
- 前端：复核矩阵「导入校准」抽屉（草稿 + 复核视图）
- 导出校准表 = 分平台宽表，各月生效日均与导出宽表一致
- 宽表导入：与系统预测相同则跳过，否则写 manual + 备注「导入」
- 导入弹窗 **撤销全部校准**：清空草稿内全部分平台 `manual_daily_avg` + `adjust_reason`（preview/commit API）
- 不在 v1：CSV 空单元格视为清除、改 `source` 枚举
- 合计/全平台明细抽屉：**只读校准**（与导入分平台真值一致；手改须切换「分平台」）

## API

- `POST /api/sales-forecast-versions/:id/calibration-import/preview`
- `POST /api/sales-forecast-versions/:id/calibration-import/commit`

Body：`{ csv: string }` 或 multipart `file`。

## 参考

- 导出列：`apps/web/server/lib/forecast-horizon-export.ts`
- 生效口径：`resolveEffectiveForecastDailyAvg`（`forecast-demand.ts`）

## 用户文档与界面提示

- 帮助中心：**§9 销售预测与运营校准**（`/help#forecast-review`）
- 复核矩阵：`导出校准表`（mode=calibration，须分平台）、导入弹窗内分平台说明、导出明细二次确认
- 深链：`/data/forecast?calibrationImport=1` 打开最新草稿的导入弹窗
- 筛选区「平台展示」旁短提示 + 导入弹窗链到帮助
