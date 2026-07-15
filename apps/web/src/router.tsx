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
import { ImportLegacyRedirect } from '@/components/import/ImportLegacyRedirect';
import { PmcListPage } from '@/pages/PmcListPage';
import { PmcDetailPage } from '@/pages/PmcDetailPage';
import { AiChatPage } from '@/pages/AiChatPage';
import { FobSettlementListPage } from '@/pages/FobSettlementListPage';
import { FobSettlementDetailPage } from '@/pages/FobSettlementDetailPage';
import { ProductMasterPage } from '@/pages/ProductMasterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SalesHistoryPage } from '@/pages/SalesHistoryPage';
import { SalesForecastListPage } from '@/pages/SalesForecastListPage';
import { SalesForecastVersionDetailPage } from '@/pages/SalesForecastVersionDetailPage';
import { HelpCenterPage } from '@/pages/HelpCenterPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { NewsIntelPage } from '@/pages/NewsIntelPage';
import { CsReplyQualityPage } from '@/pages/CsReplyQualityPage';
import { BulkStockRequestPage, ProcurementFollowUpPage } from '@/pages/ProcurementPages';
import { HomeRedirect } from '@/components/HomeRedirect';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="inventory/overview" element={<InventoryOverviewPage />} />
          <Route path="inventory/safety" element={<SafetyStockPage />} />
          <Route path="inventory/alerts" element={<AlertsPage />} />
          <Route path="pmc/suggestions" element={<ReorderSuggestionsPage />} />
          <Route path="pmc/list" element={<PmcListPage />} />
          <Route path="pmc/tracking" element={<PurchaseTrackingPage />} />
          <Route path="procurement/bulk-stock" element={<BulkStockRequestPage />} />
          <Route path="procurement/follow-up" element={<ProcurementFollowUpPage />} />
          <Route path="pmc/drafts" element={<Navigate to="/pmc/tracking" replace />} />
          <Route path="pmc/:id" element={<PmcDetailPage />} />
          <Route path="data/products" element={<ProductMasterPage />} />
          <Route path="data/import" element={<ImportLegacyRedirect />} />
          <Route path="data/sales" element={<SalesHistoryPage />} />
          <Route path="data/forecast" element={<SalesForecastListPage />} />
          <Route path="data/forecast/strategy" element={<Navigate to="/data/forecast?tab=strategy" replace />} />
          <Route path="data/forecast/:versionId" element={<SalesForecastVersionDetailPage />} />
          <Route path="pmc/import" element={<Navigate to="/pmc/list?import=1" replace />} />
          <Route path="reorder/suggestions" element={<Navigate to="/pmc/suggestions" replace />} />
          <Route path="reorder/forecast" element={<Navigate to="/data/forecast" replace />} />
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
          <Route path="system/logs" element={<AuditLogsPage />} />
          <Route path="intel/news" element={<NewsIntelPage />} />
          <Route path="cs/quality" element={<CsReplyQualityPage />} />
          <Route path="system/menus" element={<Navigate to="/system/roles" replace />} />
          <Route path="*" element={<PlaceholderPage title="404" description="页面不存在或无访问权限。" />} />
        </Route>
      </Route>
    </Routes>
  );
}
