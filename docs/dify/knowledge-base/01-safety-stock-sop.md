# 安全库存设置 SOP

## 目的

为 SKU 在各物理仓设置安全库存与补货触发点（ROP），缓冲需求波动与采购交期不确定性。

## 操作路径

库存管理 → 安全库存设置

## 两种方式

### 手动设置

逐 SKU、逐仓库编辑 `safety_stock_qty`、`reorder_point`、`reorder_qty`。

### 自动计算

1. 确保「数据中心 → 数据导入」已导入近 90 天销量
2. 运行「补货预测」定时任务或手动触发 `POST /api/tasks/replenishment-forecast`
3. 系统按 EOQ/ROP 本地算法回写安全库存配置

## 注意事项

- 在产库存为 SKU 级未分仓池，发出后才计入目的仓在途
- 美国仓网（US 区域）按仓网合计 ROP 判断是否延后单仓补货
- 修改交期 `lead_time_days` 后建议重新运行补货预测
