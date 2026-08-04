### Task 7: P3 验收回归

```bash
pnpm --filter @scm/web exec tsx --test server/lib/safety-stock-z.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/planning-dashboard.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/effective-daily-demand.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/shipment-delay.test.ts
```

| �?| 判定 |
|----|------|
| Z 方法单测�?5% / σ / L 公式正确 | |
| 默认 coverage_days 行为不变 | |
| 驾驶�?KPI 可返�?| |
| external 列存�?| |
| 飞书四列表未�?| |
| �?SAP 真实接口 | |

---
