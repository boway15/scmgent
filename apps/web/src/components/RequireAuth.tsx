import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  canAccessPath,
  flattenMenuPaths,
  getDefaultHomePath,
  hasAnyMenuAccess,
  normalizePath,
} from '@/lib/menu-utils';
import { apiUrl } from '@/lib/base-path';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { PendingAccessPage } from '@/components/PendingAccessPage';

export function RequireAuth() {
  const location = useLocation();

  const {
    data: config,
    isLoading: configLoading,
    isError: configError,
    error: configErr,
  } = useQuery({
    queryKey: ['auth-config'],
    queryFn: api.getAuthConfig,
    retry: 1,
  });

  const { data: user, isLoading: userLoading, isError: userError } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    retry: false,
    enabled: !!config && !configError,
  });

  const { data: menus = [], isLoading: menusLoading } = useQuery({
    queryKey: ['my-menus', user?.id, user?.role?.id],
    queryFn: api.getMyMenus,
    enabled: !!user,
  });

  if (configLoading) {
    return <p className="flex min-h-screen items-center justify-center text-text-sub">加载中...</p>;
  }

  if (configError || !config) {
    const detail =
      configErr instanceof Error ? configErr.message : configErr ? String(configErr) : '无响应';
    return (
      <PlaceholderPage
        title="服务不可用"
        description={`无法连接 ${apiUrl('/api/auth/config')}：${detail}。请确认后端服务已启动且数据库迁移完成。`}
      />
    );
  }

  if (userLoading || (user && menusLoading)) {
    return <p className="flex min-h-screen items-center justify-center text-text-sub">加载中...</p>;
  }

  if (userError || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!hasAnyMenuAccess(menus, user.role.code)) {
    return <PendingAccessPage />;
  }

  const pathname = normalizePath(location.pathname);
  const allowedPaths = flattenMenuPaths(menus);
  const homePath = getDefaultHomePath(menus, user.role.code);

  if (pathname === '/' || (pathname === '/dashboard' && !canAccessPath('/dashboard', allowedPaths, user.role.code))) {
    return <Navigate to={homePath} replace />;
  }

  if (!canAccessPath(pathname, allowedPaths, user.role.code)) {
    return <Navigate to={homePath} replace />;
  }

  return <Outlet />;
}
