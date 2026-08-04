### Task 8: 验收

```bash
pnpm --filter @scm/web exec tsx --test server/lib/sap-mirror/*.test.ts
pnpm --filter @scm/web exec tsx --test server/lib/inventory-position.test.ts
```

| �?| 判定 |
|----|------|
| Fixture 商家/SKU 幂等 | |
| PO 不进 position | |
| 无真�?SAP 调用 | |
| 飞书四列表未�?| |

---
