import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { ComplianceStatusBadge } from '@/components/ComplianceStatusBadge';

export function ComplianceOverviewPage() {
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'partial' | 'missing' | ''>('');

  const { data, isLoading } = useQuery({
    queryKey: ['compliance-overview', category, status],
    queryFn: () =>
      api.getComplianceOverview({
        category: category || undefined,
        status: status || undefined,
      }),
  });

  if (isLoading || !data) return <p className="text-text-sub">加载中...</p>;

  const { stats, categories, gaps } = data;
  const completePct = stats.total ? Math.round((stats.complete / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="合规总览">
        <Link to="/data/import?type=compliance" className={buttonVariants({ variant: 'outline' })}>
          批量导入
        </Link>
        <Link to="/compliance/skus" className={buttonVariants({ variant: 'outline' })}>
          SKU 合规维护
        </Link>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">SKU 总数</p>
            <p className="text-2xl font-semibold text-text-main">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">完整</p>
            <p className="text-2xl font-semibold text-emerald-600">{stats.complete}</p>
            <p className="text-xs text-text-hint">{completePct}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">部分缺失</p>
            <p className="text-2xl font-semibold text-amber-600">{stats.partial}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">未维护</p>
            <p className="text-2xl font-semibold text-text-sub">{stats.missing}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>待完善清单</CardTitle>
          <p className="text-sm text-text-sub">
            完整标准：HS 编码 + 重量 + 原产国均已填写
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">全部品类</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'partial' | 'missing' | '')}
            >
              <option value="">全部待完善</option>
              <option value="partial">部分缺失</option>
              <option value="missing">未维护</option>
            </select>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">名称</th>
                <th className="p-2 font-normal">品类</th>
                <th className="p-2 font-normal">HS</th>
                <th className="p-2 font-normal">重量 kg</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.skuId} className="border-b border-border/60">
                  <td className="p-2 font-mono">{g.skuCode}</td>
                  <td className="p-2">{g.skuName}</td>
                  <td className="p-2 text-text-sub">{g.category ?? '-'}</td>
                  <td className="p-2 font-mono">{g.hsCode ?? '-'}</td>
                  <td className="p-2 font-numeric">{g.weightKg ?? '-'}</td>
                  <td className="p-2">
                    <ComplianceStatusBadge status={g.complianceStatus} />
                  </td>
                  <td className="p-2">
                    <Link
                      to={`/compliance/skus?sku=${encodeURIComponent(g.skuCode)}`}
                      className="text-primary hover:underline"
                    >
                      编辑
                    </Link>
                  </td>
                </tr>
              ))}
              {!gaps.length && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-text-hint">
                    当前筛选下无待完善 SKU
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
