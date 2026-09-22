import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn, formatDateTimeCst } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { CostingConfigPanel } from '@/components/costing/CostingConfigPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useAuth';

type TabKey = 'products' | 'config';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  extracting: '识别中',
  ready: '已就绪',
  extract_failed: '解析失败',
};

function parseTab(param: string | null): TabKey {
  return param === 'config' ? 'config' : 'products';
}

export function ProductCostingListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  const isReadOnly = user?.role.code === 'viewer';
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['costing-projects', page, pageSize, appliedKeyword],
    queryFn: () =>
      api.listCostingProjects({
        page,
        pageSize,
        q: appliedKeyword || undefined,
      }),
    enabled: tab === 'products',
  });

  const projects = projectsQuery.data?.items ?? [];
  const total = projectsQuery.data?.total ?? 0;

  const createProject = useMutation({
    mutationFn: () => api.createCostingProject(),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
      navigate(`/procurement/costing/${project.id}`);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const deleteProject = useMutation({
    mutationFn: api.deleteCostingProject,
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['costing-projects'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const setTab = (next: TabKey) => {
    setSearchParams(next === 'config' ? { tab: 'config' } : {}, { replace: true });
  };

  return (
    <div className="min-h-full space-y-6 bg-layout">
      <PageHeader title="产品成本核算">
        {tab === 'products' && !isReadOnly && (
          <Button onClick={() => createProject.mutate()} disabled={createProject.isPending}>
            {createProject.isPending ? '创建中...' : '新建'}
          </Button>
        )}
      </PageHeader>

      <nav className="flex gap-1 border-b border-border">
        {(
          [
            ['products', '核算产品'],
            ['config', '成本配置'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors',
              tab === key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-text-sub hover:text-text-main',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'config' ? (
        <CostingConfigPanel readOnly={isReadOnly} />
      ) : (
        <>
          {message && (
            <p className="text-sm text-destructive" role="status">
              {message}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>核算产品（{total}）</CardTitle>
              <p className="text-sm text-text-sub">新建后进入详情上传设计方案，由解析识别基础信息再确认物料</p>
            </CardHeader>
            <CardContent>
              <ListSearchBar
                keyword={keyword}
                onKeywordChange={setKeyword}
                onSearch={() => {
                  setAppliedKeyword(keyword.trim());
                  setPage(1);
                }}
                placeholder="编号 / 名称 / 品类 / 区域 / 工厂"
              />
              {projectsQuery.isLoading ? (
                <p className="py-8 text-center text-sm text-text-sub">正在加载...</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-text-sub">
                        {[
                          '编号',
                          '名称',
                          '品类',
                          '区域',
                          '工厂',
                          '状态',
                          '更新时间',
                          '操作',
                        ].map((label) => (
                          <th key={label} className="p-2 font-normal">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((item) => (
                        <tr key={item.id} className="border-b border-border/60">
                          <td className="p-2 font-mono">
                            <Link
                              to={`/procurement/costing/${item.id}`}
                              className="text-primary hover:underline"
                            >
                              {item.projectNo}
                            </Link>
                          </td>
                          <td className="p-2">
                            <Link
                              to={`/procurement/costing/${item.id}`}
                              className="text-primary hover:underline"
                            >
                              {item.name}
                            </Link>
                          </td>
                          <td className="p-2">{item.category ?? '—'}</td>
                          <td className="p-2">{item.regionName ?? '—'}</td>
                          <td className="p-2">{item.factoryName ?? '—'}</td>
                          <td className="p-2">{STATUS_LABEL[item.status] ?? item.status}</td>
                          <td className="p-2 text-text-sub">{formatDateTimeCst(item.updatedAt)}</td>
                          <td className="p-2">
                            {!isReadOnly && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2 text-primary"
                                disabled={deleteProject.isPending}
                                onClick={() => {
                                  if (!window.confirm(`确定删除「${item.name}」？此操作不可恢复。`)) {
                                    return;
                                  }
                                  deleteProject.mutate(item.id);
                                }}
                              >
                                删除
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!projects.length && (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-text-hint">
                            暂无产品，点击「新建」开始核算
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {!projectsQuery.isLoading && total > 0 ? (
                <ListPagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onPageChange={setPage}
                />
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
