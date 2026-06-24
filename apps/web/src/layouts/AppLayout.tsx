import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useCurrentUser, useMyMenus } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { canAccessPath, flattenMenuPaths } from '@/lib/menu-utils';
import { Button } from '@/components/ui/button';

export function AppLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: menus = [], isLoading } = useMyMenus();
  const allowedPaths = flattenMenuPaths(menus);
  const canOpenHelp = user ? canAccessPath('/help', allowedPaths, user.role.code) : false;

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['my-menus'] });
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="flex min-h-screen bg-layout">
      {!isLoading && <Sidebar menus={menus} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-border/60 bg-card px-6 shadow-card">
          <div className="flex items-center gap-3">
            {canOpenHelp && (
              <Link to="/help" className="text-sm text-text-sub hover:text-primary">
                帮助中心
              </Link>
            )}
            {user && (
              <div className="text-sm">
                <span className="font-medium text-text-main">{user.name}</span>
                <span className="ml-2 text-text-sub">({user.role.name})</span>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? '退出中...' : '退出'}
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto bg-layout p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
