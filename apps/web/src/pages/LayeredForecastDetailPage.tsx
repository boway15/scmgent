import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  layeredForecastApi,
  type LayeredForecastNode,
  type LayeredForecastNodeLevel,
  type LayeredForecastNodesQuery,
} from '@/lib/layered-forecast-api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ForecastVersionStatusBadge } from '@/components/ForecastVersionStatusBadge';
import { mutationErrorMessage } from '@/lib/forecast-version-utils';

type DrillScope = {
  level: LayeredForecastNodeLevel;
  projectGroup?: string;
  category?: string;
  platform?: string;
};

const NEXT_LEVEL: Record<LayeredForecastNodeLevel, LayeredForecastNodeLevel | null> = {
  project_group: 'category',
  category: 'platform',
  platform: 'sku',
  sku: null,
};

const LEVEL_LABEL: Record<LayeredForecastNodeLevel, string> = {
  project_group: '项目组',
  category: '品类',
  platform: '平台',
  sku: 'SKU',
};

const nodeLabel = (node: LayeredForecastNode) => {
  if (node.level === 'project_group') return node.projectGroup;
  if (node.level === 'category') return node.category;
  if (node.level === 'platform') return node.platform;
  return node.skuId ?? 'SKU';
};

const toNumber = (value: string) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function LayeredForecastDetailPage() {
  const { versionId = '' } = useParams();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<DrillScope>({ level: 'project_group' });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const versionQuery = useQuery({
    queryKey: ['layered-forecast-version', versionId],
    queryFn: () => layeredForecastApi.getVersion(versionId),
    enabled: Boolean(versionId),
  });
  const nodeQueryParams: LayeredForecastNodesQuery = scope;
  const nodesQuery = useQuery({
    queryKey: ['layered-forecast-nodes', versionId, scope],
    queryFn: () => layeredForecastApi.listNodes(versionId, nodeQueryParams),
    enabled: Boolean(versionId),
  });
  const platformSkuQuery = useQuery({
    queryKey: ['layered-forecast-platform-skus', versionId, scope],
    queryFn: () =>
      layeredForecastApi.listNodes(versionId, {
        level: 'sku',
        projectGroup: scope.projectGroup,
        category: scope.category,
        platform: scope.platform,
        limit: 1000,
      }),
    enabled: Boolean(versionId) && scope.level === 'platform',
  });

  const invalidateNodes = async () => {
    setEdits({});
    await queryClient.invalidateQueries({ queryKey: ['layered-forecast-nodes', versionId] });
    await queryClient.invalidateQueries({ queryKey: ['layered-forecast-platform-skus', versionId] });
  };

  const saveNode = useMutation({
    mutationFn: ({ node, qty }: { node: LayeredForecastNode; qty: number }) =>
      layeredForecastApi.patchNode(versionId, node.id, {
        qty,
        cascade: node.level !== 'sku',
      }),
    onSuccess: invalidateNodes,
    onError: (mutationError) => setError(mutationErrorMessage(mutationError)),
  });
  const lockNode = useMutation({
    mutationFn: (node: LayeredForecastNode) =>
      layeredForecastApi.lockNode(versionId, node.id, !node.locked),
    onSuccess: invalidateNodes,
    onError: (mutationError) => setError(mutationErrorMessage(mutationError)),
  });
  const reconcile = useMutation({
    mutationFn: ({
      mode,
      nodeId,
    }: {
      mode: 'from_parent' | 'reset_parent_from_children';
      nodeId: string;
    }) => layeredForecastApi.reconcile(versionId, { mode, nodeId }),
    onSuccess: invalidateNodes,
    onError: (mutationError) => setError(mutationErrorMessage(mutationError)),
  });
  const publish = useMutation({
    mutationFn: () => layeredForecastApi.publish(versionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['layered-forecast-version', versionId] });
      await queryClient.invalidateQueries({ queryKey: ['layered-forecast-versions'] });
    },
    onError: (mutationError) => setError(mutationErrorMessage(mutationError)),
  });

  const nodes = nodesQuery.data?.items ?? [];
  const imbalanceByNode = useMemo(() => {
    if (scope.level !== 'platform') return new Map<string, number>();
    const childTotal = new Map<string, number>();
    for (const node of platformSkuQuery.data?.items ?? []) {
      const key = `${node.projectGroup}|${node.category}|${node.platform}|${node.period}`;
      childTotal.set(key, (childTotal.get(key) ?? 0) + node.qty);
    }
    return new Map(
      nodes.map((node) => {
        const key = `${node.projectGroup}|${node.category}|${node.platform}|${node.period}`;
        return [node.id, node.qty - (childTotal.get(key) ?? 0)];
      }),
    );
  }, [nodes, platformSkuQuery.data?.items, scope.level]);
  const peakSummary = useMemo(() => {
    const counts = new Map<number, number>();
    for (const node of nodes) {
      if (node.peakMonth != null) counts.set(node.peakMonth, (counts.get(node.peakMonth) ?? 0) + 1);
    }
    const peak = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return peak ? `${peak[0]} 月（${peak[1]} 行）` : '暂无';
  }, [nodes]);

  const isDraft = versionQuery.data?.status === 'draft';
  const drillInto = (node: LayeredForecastNode) => {
    const nextLevel = NEXT_LEVEL[scope.level];
    if (!nextLevel) return;
    setEdits({});
    setScope({
      level: nextLevel,
      projectGroup: node.projectGroup,
      category: nextLevel === 'category' ? undefined : node.category,
      platform: nextLevel === 'sku' ? node.platform : undefined,
    });
  };
  const backOneLevel = () => {
    setEdits({});
    if (scope.level === 'sku') {
      setScope({ level: 'platform', projectGroup: scope.projectGroup, category: scope.category });
    } else if (scope.level === 'platform') {
      setScope({ level: 'category', projectGroup: scope.projectGroup });
    } else {
      setScope({ level: 'project_group' });
    }
  };

  if (versionQuery.isLoading) return <p className="text-sm text-text-sub">加载版本中…</p>;
  if (versionQuery.isError || !versionQuery.data) {
    return <p className="text-sm text-destructive">{mutationErrorMessage(versionQuery.error)}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="分层销量预测详情">
        <div className="flex items-center gap-2">
          <ForecastVersionStatusBadge status={versionQuery.data.status} />
          {isDraft && (
            <Button
              disabled={publish.isPending}
              onClick={() => {
                setError(null);
                if (window.confirm('发布后版本将不可编辑，确定发布？')) publish.mutate();
              }}
            >
              {publish.isPending ? '发布中…' : '发布'}
            </Button>
          )}
        </div>
      </PageHeader>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 text-sm text-text-sub">
          独立模块，不进补货；非原销售预测。
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{versionQuery.data.versionName}</CardTitle>
            <p className="mt-1 font-mono text-xs text-text-sub">
              {versionQuery.data.versionNo} · {versionQuery.data.startMonth} 起 · {versionQuery.data.horizonMonths} 月
            </p>
          </div>
          <span className="text-sm text-text-sub">旺季汇总：{peakSummary}</span>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link className="text-primary hover:underline" to="/data/layered-forecast">版本列表</Link>
            <span className="text-text-hint">/</span>
            <button className="text-primary hover:underline" type="button" onClick={() => setScope({ level: 'project_group' })}>
              项目组
            </button>
            {scope.projectGroup && <><span className="text-text-hint">/</span><span>{scope.projectGroup}</span></>}
            {scope.category && <><span className="text-text-hint">/</span><span>{scope.category}</span></>}
            {scope.platform && <><span className="text-text-hint">/</span><span>{scope.platform}</span></>}
          </div>
          {scope.level !== 'project_group' && (
            <Button variant="outline" size="sm" onClick={backOneLevel}>返回上一层</Button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {scope.level === 'platform' && (
            <p className="text-xs text-text-sub">
              平台层显示“父层差额”：平台预测量减去其 SKU 预测量之和；非零差额会阻止发布。
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{LEVEL_LABEL[scope.level]}层</CardTitle>
        </CardHeader>
        <CardContent>
          {nodesQuery.isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : nodesQuery.isError ? (
            <p className="text-sm text-destructive">{mutationErrorMessage(nodesQuery.error)}</p>
          ) : nodes.length === 0 ? (
            <p className="text-sm text-text-sub">此层暂无节点。</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">{LEVEL_LABEL[scope.level]}</th>
                    <th className="p-2 font-normal">期间</th>
                    <th className="p-2 font-normal">预测量</th>
                    <th className="p-2 font-normal">系统量</th>
                    <th className="p-2 font-normal">季节系数</th>
                    <th className="p-2 font-normal">旺季月</th>
                    {scope.level === 'sku' && <th className="p-2 font-normal">锁定</th>}
                    {scope.level === 'platform' && <th className="p-2 font-normal">父层差额</th>}
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => {
                    const editingValue = edits[node.id] ?? String(node.qty);
                    const parsedQty = toNumber(editingValue);
                    const imbalance = imbalanceByNode.get(node.id);
                    const canSave = isDraft && parsedQty != null && parsedQty >= 0 && parsedQty !== node.qty;
                    return (
                      <tr key={node.id} className="border-b border-border/60 align-middle">
                        <td className="p-2 font-medium">{nodeLabel(node)}</td>
                        <td className="p-2 font-mono">{node.period}</td>
                        <td className="p-2">
                          {isDraft ? (
                            <div className="flex items-center gap-2">
                              <Input
                                aria-label={`${nodeLabel(node)} ${node.period} 预测量`}
                                className="h-8 w-28 font-numeric"
                                inputMode="decimal"
                                value={editingValue}
                                onChange={(event) => setEdits((current) => ({ ...current, [node.id]: event.target.value }))}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!canSave || saveNode.isPending}
                                onClick={() => {
                                  setError(null);
                                  if (parsedQty != null) saveNode.mutate({ node, qty: parsedQty });
                                }}
                              >
                                保存
                              </Button>
                            </div>
                          ) : (
                            <span className="font-numeric">{node.qty.toFixed(2)}</span>
                          )}
                        </td>
                        <td className="p-2 font-numeric">{node.systemQty.toFixed(2)}</td>
                        <td className="p-2 font-numeric">{node.seasonalityFactor?.toFixed(3) ?? '—'}</td>
                        <td className="p-2">{node.peakMonth ? `${node.peakMonth} 月` : '—'}</td>
                        {scope.level === 'sku' && (
                          <td className="p-2">
                            {isDraft ? (
                              <label className="flex items-center gap-1 text-xs">
                                <input
                                  type="checkbox"
                                  checked={node.locked}
                                  disabled={lockNode.isPending}
                                  onChange={() => {
                                    setError(null);
                                    lockNode.mutate(node);
                                  }}
                                />
                                {node.locked ? '已锁定' : '未锁定'}
                              </label>
                            ) : (
                              node.locked ? '已锁定' : '未锁定'
                            )}
                          </td>
                        )}
                        {scope.level === 'platform' && (
                          <td className={`p-2 font-numeric ${Math.abs(imbalance ?? 0) > 0.01 ? 'text-destructive' : 'text-emerald-700'}`}>
                            {(imbalance ?? 0).toFixed(2)}
                          </td>
                        )}
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            {NEXT_LEVEL[scope.level] && (
                              <button className="text-primary hover:underline" type="button" onClick={() => drillInto(node)}>
                                下钻
                              </button>
                            )}
                            {isDraft && node.level === 'platform' && (
                              <button
                                className="text-primary hover:underline"
                                type="button"
                                disabled={reconcile.isPending}
                                onClick={() => reconcile.mutate({ mode: 'from_parent', nodeId: node.id })}
                              >
                                按父层 reconcile
                              </button>
                            )}
                            {isDraft && node.level !== 'project_group' && (
                              <button
                                className="text-primary hover:underline"
                                type="button"
                                disabled={reconcile.isPending}
                                onClick={() => reconcile.mutate({ mode: 'reset_parent_from_children', nodeId: node.id })}
                              >
                                按子重设父层
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
