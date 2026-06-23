import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { InventoryOverviewPage } from '@/pages/InventoryOverviewPage';
import { SafetyStockPage } from '@/pages/SafetyStockPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { ReorderSuggestionsPage } from '@/pages/ReorderSuggestionsPage';
import { PurchaseTrackingPage } from '@/pages/PurchaseTrackingPage';
import { RoleMenusPage } from '@/pages/RoleMenusPage';
import { UsersPage } from '@/pages/UsersPage';
import { ImportPage } from '@/pages/ImportPage';
import { PmcListPage } from '@/pages/PmcListPage';
import { PmcDetailPage } from '@/pages/PmcDetailPage';
import { AiChatPage } from '@/pages/AiChatPage';
import { FobSettlementListPage } from '@/pages/FobSettlementListPage';
import { FobSettlementDetailPage } from '@/pages/FobSettlementDetailPage';
import { ProductMasterPage } from '@/pages/ProductMasterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SalesHistoryPage } from '@/pages/SalesHistoryPage';
import { HelpCenterPage } from '@/pages/HelpCenterPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="inventory/overview" element={<InventoryOverviewPage />} />
          <Route path="inventory/safety" element={<SafetyStockPage />} />
          <Route path="inventory/alerts" element={<AlertsPage />} />
          <Route path="pmc/suggestions" element={<ReorderSuggestionsPage />} />
          <Route path="pmc/list" element={<PmcListPage />} />
          <Route path="pmc/tracking" element={<PurchaseTrackingPage />} />
          <Route path="pmc/drafts" element={<Navigate to="/pmc/tracking" replace />} />
          <Route path="pmc/:id" element={<PmcDetailPage />} />
          <Route path="data/products" element={<ProductMasterPage />} />
          <Route path="data/import" element={<ImportPage />} />
          <Route path="data/sales" element={<SalesHistoryPage />} />
          <Route path="pmc/import" element={<Navigate to="/data/import?type=pmc_plans" replace />} />
          <Route path="reorder/suggestions" element={<Navigate to="/pmc/suggestions" replace />} />
          <Route path="reorder/forecast" element={<Navigate to="/pmc/suggestions" replace />} />
          <Route path="reorder/drafts" element={<Navigate to="/pmc/tracking" replace />} />
          <Route path="logistics/fob-settlement" element={<FobSettlementListPage />} />
          <Route
            path="logistics/fob-fee-rules"
            element={<Navigate to="/logistics/fob-settlement?tab=rules" replace />}
          />
          <Route path="logistics/fob-settlement/:id" element={<FobSettlementDetailPage />} />
          <Route path="ai/chat" element={<AiChatPage />} />
          <Route path="help" element={<HelpCenterPage />} />
          <Route path="system/users" element={<UsersPage />} />
          <Route path="system/roles" element={<RoleMenusPage />} />
          <Route path="system/menus" element={<Navigate to="/system/roles" replace />} />
          <Route path="*" element={<PlaceholderPage title="404" description="页面不存在或无访问权限。" />} />
        </Route>
      </Route>
    </Routes>
  );
}
