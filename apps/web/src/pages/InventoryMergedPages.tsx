import { TabbedPage } from '@/components/TabbedPage';
import { InventoryOverviewPage } from '@/pages/InventoryOverviewPage';
import { InventoryQueryPage } from '@/pages/InventoryQueryPage';
import { ProcurementOpsPage } from '@/pages/ProcurementOpsPage';
import { InventoryPoolsPage } from '@/pages/InventoryPoolsPage';
import { InventoryUnallocatedPage } from '@/pages/InventoryUnallocatedPage';
import { SafetyStockPage } from '@/pages/SafetyStockPage';
import { LeadTimeProfilesPage } from '@/pages/LeadTimeProfilesPage';

/** 菜单「库存查询」：周转 / 分仓明细 / 全链三张飞书快照表 */
export function InventoryStockPage() {
  return (
    <TabbedPage
      tabs={[
        { id: 'turnover', label: '库存周转', render: () => <InventoryOverviewPage /> },
        { id: 'query', label: '分仓明细', render: () => <InventoryQueryPage /> },
        { id: 'procurement-ops', label: '全链库存', render: () => <ProcurementOpsPage /> },
      ]}
    />
  );
}

/** 菜单「供给池」：三池批次 + 未定仓 */
export function InventorySupplyPage() {
  return (
    <TabbedPage
      tabs={[
        { id: 'pools', label: '库存三池', render: () => <InventoryPoolsPage /> },
        { id: 'unallocated', label: '未定仓供应', render: () => <InventoryUnallocatedPage /> },
      ]}
    />
  );
}

/** 菜单「规划参数」：安全库存 + 交期 */
export function PlanningParamsPage() {
  return (
    <TabbedPage
      tabs={[
        { id: 'safety', label: '安全库存', render: () => <SafetyStockPage /> },
        { id: 'lead-time', label: '交期配置', render: () => <LeadTimeProfilesPage /> },
      ]}
    />
  );
}
