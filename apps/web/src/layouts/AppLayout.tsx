import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Sidebar } from '@/components/Sidebar';
import { useCurrentUser, useMyMenus } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function AppLayout() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { data: menus = [], isLoading } = useMyMenus();

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => navigate('/login'),
  });

  return (
    <div className="flex min-h-screen bg-layout">
      {!isLoading && <Sidebar menus={menus} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border/60 bg-card px-6 shadow-card">
          <span className="text-sm text-text-sub">跨境电商供应链智能体平台</span>
          <div className="flex items-center gap-3">
            <Link to="/help" className="text-sm text-text-sub hover:text-primary">
              帮助中心
            </Link>
            {user && (
              <div className="text-sm">
                <span className="font-medium text-text-main">{user.name}</span>
                <span className="ml-2 text-text-sub">({user.role.name})</span>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => logout.mutate()}>
              退出
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
