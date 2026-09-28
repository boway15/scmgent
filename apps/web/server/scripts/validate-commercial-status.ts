/**
 * 商业状态 + 规划驾驶舱一轮验证（本地 Docker DB）
 * 用法：cd apps/web && npx tsx server/scripts/validate-commercial-status.ts
 */
import { eq, sql } from 'drizzle-orm';
import { db, skus } from '@scm/db';
import { applyCommercialStatus } from '../lib/commercial-status.js';
import { reconcileCommercialStatusFromAllSources } from '../lib/commercial-status-sync.js';
import { getPlanningDashboard } from '../lib/planning-dashboard.js';

async function seedSampleStatuses() {
  const samples = await db
    .select({ id: skus.id, code: skus.code })
    .from(skus)
    .where(eq(skus.isActive, true))
    .limit(5);

  const labels = ['停售', '即将停售', 'Active', '清仓', '下架'];
  let seeded = 0;
  for (let i = 0; i < Math.min(samples.length, labels.length); i++) {
    const sku = samples[i]!;
    const result = await applyCommercialStatus({
      skuId: sku.id,
      rawStatus: labels[i]!,
      source: 'manual',
      force: true,
    });
    if (result === 'updated' || result === 'unchanged') seeded += 1;
    console.log(`  seed ${sku.code} → ${labels[i]} (${result})`);
  }
  return seeded;
}

async function main() {
  console.log('=== 1. Reconcile（现有快照/采购数据）===');
  const reconcile = await reconcileCommercialStatusFromAllSources();
  console.log(JSON.stringify(reconcile, null, 2));

  console.log('\n=== 2. 样本 SKU 手工写入（验证驾驶舱计数）===');
  const seeded = await seedSampleStatuses();
  console.log(`  seeded=${seeded}`);

  console.log('\n=== 3. 商业状态分布 ===');
  const dist = await db.execute(sql`
    SELECT commercial_status_norm AS norm, count(*)::int AS count
    FROM skus WHERE is_active = true
    GROUP BY 1 ORDER BY count DESC
  `);
  console.table(Array.from(dist as unknown as Array<{ norm: string | null; count: number }>));

  console.log('\n=== 4. 规划驾驶舱 KPI ===');
  const dashboard = await getPlanningDashboard();
  console.log({
    skuActiveCount: dashboard.skuActiveCount,
    skuOperationalCount: dashboard.skuOperationalCount,
    skuDormantCount: dashboard.skuDormantCount,
    skuPlanningEligibleCount: dashboard.skuPlanningEligibleCount,
    skuGrayLifecycleCount: dashboard.skuGrayLifecycleCount,
    forecastCoverageRate: dashboard.forecastCoverageRate,
    healthRedSkuCount: dashboard.healthRedSkuCount,
    calculatedAt: dashboard.calculatedAt,
  });

  console.log('\n=== 5. 公式校验 ===');
  const sum =
    dashboard.skuPlanningEligibleCount + (dashboard.skuGrayLifecycleCount ?? 0);
  console.log(
    `运营 ${dashboard.skuOperationalCount} ≈ 可规划 ${dashboard.skuPlanningEligibleCount} + 疑似停售 ${dashboard.skuGrayLifecycleCount} (=${sum})`,
  );
  console.log(
    `主数据启用 ${dashboard.skuActiveCount} = 运营 ${dashboard.skuOperationalCount} + 休眠 ${dashboard.skuDormantCount}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
