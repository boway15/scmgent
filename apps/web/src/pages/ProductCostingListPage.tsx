import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CostingProjectStatus } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/ListPagination';
import { cn, formatDateTimeCst } from '@/lib/utils';

const STATUS_LABEL: Record<CostingProjectStatus, string> = {
  draft: '草稿',
  extracting: 'AI 拆解中',
  bom_draft: '清单待确认',
  bom_ready: '清单已确认',
  costed: '已核算',
  extract_failed: '拆解失败',
};

const STATUS_CLASS: Record<CostingProjectStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  extracting: 'bg-amber-100 text-amber-800',
  bom_draft: 'bg-sky-100 text-sky-800',
  bom_ready: 'bg-emerald-100 text-emerald-800',
  costed: 'bg-orange-100 text-orange-800',
  extract_failed: 'bg-red-100 text-red-700',
};

export function ProductCostingListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', category: '板式办公桌' });
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['product-costing', page, pageSize, appliedKeyword],
    queryFn: () =>
      api.listProductCosting({
        page,
        pageSize,
        keyword: appliedKeyword || undefined,
      }),
  });

  const { data: status } = useQuery({
    queryKey: ['product-costing-status'],
    queryFn: () => api.getProductCostingStatus(),
  });

  const create = useMutation({
    mutationFn: () => api.createProductCosting({ name: form.name, category: form.category }),
    onSuccess: (row) => {
      setError('');
      setShowForm(false);
      setForm({ name: '', category: '板式办公桌' });
      qc.invalidateQueries({ queryKey: ['product-costing'] });
      navigate(`/procurement/costing/${row.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProductCosting(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['product-costing'] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="产品成本核算"
        description="上传设计方案，AI 拆原材料清单，人工确认后导出 Excel。成本金额核算为后续里程碑。"
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Input
            className="max-w-xs"
            placeholder="搜索单号/名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setAppliedKeyword(keyword.trim());
                setPage(1);
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
          >
            搜索
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>新建核算单</Button>
          <span className="text-sm text-text-hint">
            Dify：{status?.difyEnabled ? '已配置' : '未配置（仍可手工维护清单）'}
          </span>
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">产品/方案名称</span>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如：实木弯腿行政桌"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">品类提示（给 AI）</span>
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </label>
            <Button
              disabled={!form.name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? '创建中…' : '创建'}
            </Button>
            {error && <p className="w-full text-sm text-red-600">{error}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-text-sub">加载中…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-text-sub">
                    <th className="py-2 pr-3">单号</th>
                    <th className="py-2 pr-3">名称</th>
                    <th className="py-2 pr-3">品类</th>
                    <th className="py-2 pr-3">状态</th>
                    <th className="py-2 pr-3">更新时间</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-mono text-xs">{row.projectNo}</td>
                      <td className="py-2 pr-3">
                        <Link className="text-brand hover:underline" to={`/procurement/costing/${row.id}`}>
                          {row.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{row.category || '—'}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            'inline-flex rounded px-2 py-0.5 text-xs',
                            STATUS_CLASS[row.status],
                          )}
                        >
                          {STATUS_LABEL[row.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-text-sub">
                        {formatDateTimeCst(row.updatedAt)}
                      </td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() => {
                            if (window.confirm(`删除「${row.name}」？附件与清单将一并删除。`)) {
                              remove.mutate(row.id);
                            }
                          }}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!data?.items.length && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-text-hint">
                        暂无核算单，点击「新建核算单」开始
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {data && (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
