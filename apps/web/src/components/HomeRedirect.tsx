import { Navigate } from 'react-router-dom';
import { useCurrentUser, useMyMenus } from '@/hooks/useAuth';
import { getDefaultHomePath } from '@/lib/menu-utils';

export function HomeRedirect() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data: menus = [], isLoading: menusLoading } = useMyMenus();

  if (userLoading || menusLoading) {
    return <p className="text-text-sub">加载中...</p>;
  }

  return <Navigate to={getDefaultHomePath(menus, user?.role.code)} replace />;
}
