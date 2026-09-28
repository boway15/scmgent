/**
 * 重算库存健康快照并输出规划驾驶舱 KPI
 * 用法：cd apps/web && npx tsx server/scripts/recompute-health-dashboard.ts
 */
import { computeAllInventoryHealth } from '../lib/inventory-health-service.js';
import { saveHealthSnapshots } from '../lib/inventory-health-store.js';
import { getPlanningDashboard } from '../lib/planning-dashboard.js';

async function main() {
  console.log('=== 重算库存健康 ===');
  const t0 = Date.now();
  const rows = await computeAllInventoryHealth();
  const saved = await saveHealthSnapshots(rows);
  console.log(`saved=${saved} rows=${rows.length} elapsed=${Date.now() - t0}ms`);

  const redRows = rows.filter((r) => r.healthStatus === 'red');
  const redSkus = new Set(redRows.map((r) => r.skuId));
  const withQty = rows.filter((r) => r.effectiveQty > 0);
  console.log({
    redPairCount: redRows.length,
    redSkuCount: redSkus.size,
    pairsWithEffectiveQty: withQty.length,
    sampleEffectiveQty: withQty.slice(0, 3).map((r) => ({
      sku: r.skuCode,
      wh: r.warehouseCode,
      qty: r.effectiveQty,
      health: r.healthStatus,
    })),
  });

  console.log('\n=== 规划驾驶舱 KPI ===');
  const dashboard = await getPlanningDashboard();
  console.log({
    skuActiveCount: dashboard.skuActiveCount,
    skuGrayLifecycleCount: dashboard.skuGrayLifecycleCount,
    healthRedSkuCount: dashboard.healthRedSkuCount,
    healthYellowSkuCount: dashboard.healthYellowSkuCount,
    forecastCoverageRate: dashboard.forecastCoverageRate,
    stockoutHorizon7: dashboard.stockoutHorizon7,
    stockoutHorizon15: dashboard.stockoutHorizon15,
    stockoutHorizon30: dashboard.stockoutHorizon30,
    calculatedAt: dashboard.calculatedAt,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
