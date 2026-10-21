import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';

export type PageTab = {
  id: string;
  label: string;
  render: () => ReactNode;
};

/** 合并菜单的页签容器：?tab= 选中页签，第一个为默认页签（不写入 URL）。 */
export function TabbedPage({ tabs }: { tabs: PageTab[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const active = tabs.find((t) => t.id === requested) ?? tabs[0]!;

  const selectTab = (id: string) => {
    if (id === active.id) return;
    setSearchParams(id === tabs[0]!.id ? {} : { tab: id });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {tabs.map((tab) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                selected
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-text-sub hover:text-text-main',
              )}
              onClick={() => selectTab(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div key={active.id}>{active.render()}</div>
    </div>
  );
}

/** 旧菜单路径 → 合并页对应页签，保留原有查询参数。 */
export function LegacyTabRedirect({ to, tab }: { to: string; tab?: string }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  if (tab) params.set('tab', tab);
  const query = params.toString();
  return <Navigate to={`${to}${query ? `?${query}` : ''}`} replace />;
}
