import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { useCurrentUser, useMyMenus } from '@/hooks/useAuth';
import { getDefaultHomePath } from '@/lib/menu-utils';

const LEGACY_PATH_HINTS: Record<string, string> = {
  '/data/layered-forecast': '「分层销量预测」已并入「销售预测」，请从侧栏进入销售预测。',
  '/data/sap-mirror': '「SAP 镜像同步」已下线，可在商品主数据或销量历史中导入/核对数据。',
  '/compliance': '合规管理模块已移除，相关说明见帮助中心。',
  '/compliance/overview': '合规管理模块已移除，相关说明见帮助中心。',
  '/compliance/skus': '合规管理模块已移除，相关说明见帮助中心。',
  '/data/import': '数据中心已取消独立入口，请从各业务页（库存总览、商品主数据等）使用「导入」。',
};

export function NotFoundPage() {
  const location = useLocation();
  const pathname = location.pathname;
  const { data: user } = useCurrentUser();
  const { data: menus = [] } = useMyMenus();
  const homePath = getDefaultHomePath(menus, user?.role?.code);
  const legacyHint =
    LEGACY_PATH_HINTS[pathname] ??
    Object.entries(LEGACY_PATH_HINTS).find(([prefix]) => pathname.startsWith(`${prefix}/`))?.[1];

  return (
    <div className="space-y-6">
      <PageHeader title="404" />
      <Card>
        <CardHeader>
          <CardTitle>功能说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-text-sub">页面不存在或无访问权限。</p>
          <p className="font-mono text-sm text-text-hint">当前路径：{pathname}</p>
          {legacyHint ? <p className="text-sm text-amber-800">{legacyHint}</p> : null}
          <p className="text-sm text-text-sub">
            若侧栏仍显示已下线功能，请联系管理员执行数据库迁移或同步菜单种子（角色与菜单）。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="default">
              <Link to={homePath}>返回首页</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/help">帮助中心</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
