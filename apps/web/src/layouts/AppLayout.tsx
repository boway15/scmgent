import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, CircleHelp, X } from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { useCurrentUser, useMyMenus } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import {
  clearDownloadNotice,
  subscribeDownloadNotice,
  type DownloadQueuedNotice,
} from '@/lib/download-notice';
import { menusForSidebar } from '@/lib/menu-utils';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NOTICE_AUTO_DISMISS_MS = 10_000;

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const { data: menus = [], isLoading } = useMyMenus();
  const sidebarMenus = menusForSidebar(menus);
  const [notice, setNotice] = useState<DownloadQueuedNotice | null>(null);
  const onDownloadsPage = location.pathname === '/downloads' || location.pathname.startsWith('/downloads/');

  useEffect(() => subscribeDownloadNotice(setNotice), []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => clearDownloadNotice(), NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice?.at]);

  useEffect(() => {
    if (onDownloadsPage) clearDownloadNotice();
  }, [onDownloadsPage]);

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['my-menus'] });
      navigate('/login', { replace: true });
    },
  });

  const highlightDownloads = Boolean(notice) && !onDownloadsPage;

  return (
    <div className="flex min-h-screen bg-layout">
      {!isLoading && <Sidebar menus={sidebarMenus} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-border/60 bg-card px-6 shadow-card">
          <div className="flex items-center gap-2">
            {user && (
              <>
                <Link
                  to="/downloads"
                  title="下载中心"
                  aria-label="下载中心"
                  onClick={() => clearDownloadNotice()}
                  className={cn(
                    'relative inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors',
                    highlightDownloads
                      ? 'bg-primary text-white shadow-sm ring-2 ring-primary/30 ring-offset-2 ring-offset-card'
                      : 'text-text-sub hover:bg-muted hover:text-primary',
                  )}
                >
                  <Download className="h-4 w-4" />
                  <span className={cn(highlightDownloads ? 'font-medium' : 'hidden sm:inline')}>
                    下载中心
                  </span>
                  {highlightDownloads && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-white ring-2 ring-primary" />
                  )}
                </Link>
                <Link
                  to="/help"
                  title="帮助中心"
                  aria-label="帮助中心"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-text-sub transition-colors hover:bg-muted hover:text-primary"
                >
                  <CircleHelp className="h-4 w-4" />
                  <span>帮助中心</span>
                </Link>
              </>
            )}
            {user && (
              <div className="ml-1 text-sm">
                <span className="font-medium text-text-main">{user.name}</span>
                <span className="ml-2 text-text-sub">({user.role.name})</span>
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              {logout.isPending ? '退出中...' : '退出'}
            </Button>
          </div>
        </header>

        {notice && !onDownloadsPage && (
          <div className="pointer-events-none absolute right-6 top-[3.75rem] z-40 w-[min(22rem,calc(100%-3rem))]">
            <div className="pointer-events-auto rounded-md border border-primary/20 bg-card p-3 shadow-card">
              <div className="flex items-start gap-2">
                <Download className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-main">{notice.message}</p>
                  <Link
                    to={notice.downloadCenterPath || '/downloads'}
                    onClick={() => clearDownloadNotice()}
                    className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
                  >
                    前往下载中心查看
                  </Link>
                </div>
                <button
                  type="button"
                  aria-label="关闭提示"
                  className="rounded p-0.5 text-text-hint hover:bg-muted hover:text-text-sub"
                  onClick={() => clearDownloadNotice()}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-auto bg-layout p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
