import { Link, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  layeredForecastApi,
  type LayeredForecastVersion,
} from '@/lib/layered-forecast-api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ForecastVersionStatusBadge } from '@/components/ForecastVersionStatusBadge';
import { buildForecastStartMonthOptions, formatForecastStartMonth } from '@/lib/forecast-horizon-meta';
import { formatForecastDateTime, mutationErrorMessage } from '@/lib/forecast-version-utils';

export function LayeredForecastListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [startMonth, setStartMonth] = useState(() => formatForecastStartMonth());
  const [horizonMonths, setHorizonMonths] = useState(12);
  const [projectGroup, setProjectGroup] = useState('');
  const [category, setCategory] = useState('');
  const startMonthOptions = useMemo(() => buildForecastStartMonthOptions(), []);

  const { data, isLoading } = useQuery({
    queryKey: ['layered-forecast-versions'],
    queryFn: layeredForecastApi.listVersions,
  });

  const generate = useMutation({
    mutationFn: () =>
      layeredForecastApi.generate({
        startMonth,
        horizonMonths,
        projectGroup: projectGroup.trim() || undefined,
        category: category.trim() || undefined,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['layered-forecast-versions'] });
      navigate(`/data/layered-forecast/${result.versionId}`);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="分层销量预测" />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 text-sm text-text-sub">
          独立模块，不进补货；非原销售预测。该模块用于按组别、品类、平台和 SKU 分层校准销量。
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>生成分层预测</CardTitle>
          <p className="text-sm text-text-sub">每次生成会创建一份独立草稿版本。</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">开始月</span>
              <select
                className="flex h-9 rounded-md border border-border bg-card px-2 text-sm"
                value={startMonth}
                onChange={(event) => setStartMonth(event.target.value)}
              >
                {startMonthOptions.map((month) => (
                  <option key={month} value={month}>
                    {month}{month === formatForecastStartMonth() ? '（当月）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">预测月数</span>
              <select
                className="flex h-9 rounded-md border border-border bg-card px-2 text-sm"
                value={horizonMonths}
                onChange={(event) => setHorizonMonths(Number(event.target.value))}
              >
                {[6, 12, 18].map((value) => (
                  <option key={value} value={value}>
                    {value} 个月
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">项目组（可选）</span>
              <Input
                className="h-9 w-40"
                value={projectGroup}
                placeholder="全部项目组"
                onChange={(event) => setProjectGroup(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">品类（可选）</span>
              <Input
                className="h-9 w-48"
                value={category}
                placeholder="全部品类"
                onChange={(event) => setCategory(event.target.value)}
              />
            </label>
            <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending ? '生成中…' : '生成草稿'}
            </Button>
          </div>
          {generate.isError && <p className="text-sm text-destructive">{mutationErrorMessage(generate.error)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>预测版本</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : !data?.items.length ? (
            <p className="text-sm text-text-sub">暂无分层预测版本，请先生成草稿。</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">版本</th>
                    <th className="p-2 font-normal">开始月</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">预测月数</th>
                    <th className="p-2 font-normal">创建时间</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((version) => <LayeredVersionRow key={version.id} version={version} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LayeredVersionRow({ version }: { version: LayeredForecastVersion }) {
  return (
    <tr className="border-b border-border/60">
      <td className="p-2">
        <p className="font-medium text-text-main">{version.versionName}</p>
        <p className="font-mono text-xs text-text-sub">{version.versionNo}</p>
      </td>
      <td className="p-2 font-mono">{version.startMonth}</td>
      <td className="p-2"><ForecastVersionStatusBadge status={version.status} /></td>
      <td className="p-2 font-numeric">{version.horizonMonths} 月</td>
      <td className="p-2 text-xs text-text-sub">{formatForecastDateTime(version.createdAt)}</td>
      <td className="p-2">
        <Link className="text-primary hover:underline" to={`/data/layered-forecast/${version.id}`}>
          查看详情
        </Link>
      </td>
    </tr>
  );
}
