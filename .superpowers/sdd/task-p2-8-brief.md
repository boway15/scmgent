### Task 8: P2 验收回归

```bash
pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/shipment-delay.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-health-service.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/lead-time-resolver.test.ts
```

手工/代码核对�?
| �?| 判定 |
|----|------|
| 有断货史样本：修正后 avgDaily > 日历均摊 | |
| 无库存历史：stockoutAdjusted false | |
| 可创建发运并维护节点 | |
| 延误 Tab 可见逾期 | |
| 飞书四列表列结构未改 | |
| �?FOB 模块改动 | |

可选：设计 §13 标注 P2 实现计划路径�?
---
