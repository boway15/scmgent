import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { canAccessPath, flattenMenuPaths } from '@/lib/menu-utils';
import { apiUrl } from '@/lib/base-path';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

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

  const { data: menus = [] } = useQuery({
    queryKey: ['my-menus'],
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
        description={`无法连接 ${apiUrl('/api/auth/config')}：${detail}。请确认已运行 source_package/scripts/miaoda-sync-to-server.js、重新构建发布，且 ScmHonoModule 在 ViewModule 之前。`}
      />
    );
  }

  if (userLoading) {
    return <p className="flex min-h-screen items-center justify-center text-text-sub">加载中...</p>;
  }

  if (config.feishuEnabled && (userError || !user)) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const pathname = location.pathname;
  const allowedPaths = flattenMenuPaths(menus);

  if (user && !canAccessPath(pathname, allowedPaths, user.role.code)) {
    return (
      <PlaceholderPage title="403" description="您没有访问此页面的权限，请联系管理员。" />
    );
  }

  return <Outlet />;
}
