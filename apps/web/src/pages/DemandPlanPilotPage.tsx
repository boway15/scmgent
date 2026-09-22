import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type DemandPlanMonthRow,
  type DemandPlanVersionListItem,
  type DemandPlanWeekRow,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mutationErrorMessage } from '@/lib/forecast-version-utils';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pilot_published: '已发布试点',
  archived: '已归档',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  pilot_published: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800',
  archived: 'border-border bg-muted text-text-sub',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? STATUS_CLASS.archived}`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function formatDaily(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4) : value;
}

export function DemandPlanPilotPage() {
  const queryClient = useQueryClient();
  const [projectGroup, setProjectGroup] = useState('');
  const [warehouseCode, setWarehouseCode] = useState('US-WEST');
  const [versionName, setVersionName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skuFilter, setSkuFilter] = useState('');
  const [edits, setEdits] = useState<Record<string, { manual: string; reason: string }>>({});

  const versionsQuery = useQuery({
    queryKey: ['demand-plan-versions'],
    queryFn: api.listDemandPlanVersions,
  });

  const detailQuery = useQuery({
    queryKey: ['demand-plan', selectedId],
    queryFn: () => api.getDemandPlan(selectedId!),
    enabled: Boolean(selectedId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['demand-plan-versions'] });
    if (selectedId) {
      await queryClient.invalidateQueries({ queryKey: ['demand-plan', selectedId] });
    }
  };

  const generate = useMutation({
    mutationFn: () =>
      api.generateDemandPlan({
        projectGroup: projectGroup.trim(),
        warehouseCode: warehouseCode.trim() || 'US-WEST',
        versionName: versionName.trim() || undefined,
      }),
    onSuccess: async (result) => {
      setEdits({});
      await queryClient.invalidateQueries({ queryKey: ['demand-plan-versions'] });
      setSelectedId(result.version.id);
    },
  });

  const publish = useMutation({
    mutationFn: ({ id, adopt }: { id: string; adopt: boolean }) =>
      api.publishDemandPlan(id, { adopt }),
    onSuccess: invalidate,
  });

  const adoptWeekly = useMutation({
    mutationFn: (id: string) => api.adoptDemandPlan(id),
    onSuccess: invalidate,
  });

  const adoptMonthly = useMutation({
    mutationFn: (input: { projectGroup: string; warehouseCode: string }) =>
      api.adoptForecast(input),
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: (id: string) => api.archiveDemandPlan(id),
    onSuccess: invalidate,
  });

  const savePeriod = useMutation({
    mutationFn: (input: {
      periodId: string;
      grain: 'week' | 'month';
      manualDailyAvg: number | null;
      adjustReason: string;
    }) =>
      input.grain === 'week'
        ? api.updateDemandPlanWeek(selectedId!, input.periodId, {
            manualDailyAvg: input.manualDailyAvg,
            adjustReason: input.adjustReason,
          })
        : api.updateDemandPlanMonth(selectedId!, input.periodId, {
            manualDailyAvg: input.manualDailyAvg,
            adjustReason: input.adjustReason,
          }),
    onSuccess: async (_data, variables) => {
      setEdits((current) => {
        const next = { ...current };
        delete next[variables.periodId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['demand-plan', selectedId] });
    },
  });

  const versions = versionsQuery.data ?? [];
  const selected = versions.find((row) => row.id === selectedId) ?? detailQuery.data?.version;
  const isDraft = selected?.status === 'draft';
  const weeks = detailQuery.data?.weeks;
  const useWeeks = (weeks?.length ?? 0) > 0;
  const grain: 'week' | 'month' = useWeeks ? 'week' : 'month';
  const periodRows: DemandPlanWeekRow[] = useWeeks ? weeks! : (detailQuery.data?.months ?? []);
  const adoption = detailQuery.data?.adoption;
  const adoptedVersionNo =
    adoption?.source === 'demand_plan'
      ? versions.find((row) => row.id === adoption.demandPlanVersionId)?.versionNo ??
        (adoption.demandPlanVersionId === selected?.id ? selected.versionNo : null)
      : null;
  const filteredRows = useMemo(() => {
    const needle = skuFilter.trim().toUpperCase();
    if (!needle) return periodRows;
    return periodRows.filter((row) => (row.skuCode ?? '').toUpperCase().includes(needle));
  }, [periodRows, skuFilter]);

  const selectVersion = (id: string) => {
    setEdits({});
    setSelectedId(id);
  };

  const saveRow = (row: DemandPlanMonthRow) => {
    const draft = edits[row.id];
    const raw = (draft?.manual ?? row.manualDailyAvg ?? '').trim();
    const reason = (draft?.reason ?? row.adjustReason ?? '').trim();
    const manualDailyAvg = raw === '' ? null : Number(raw);
    if (manualDailyAvg != null && !Number.isFinite(manualDailyAvg)) return;
    savePeriod.mutate({ periodId: row.id, grain, manualDailyAvg, adjustReason: reason });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="需求计划试点" />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 text-sm text-text-sub">
          仅试点项目组 × 仓（默认 US-WEST）。生成草稿后可改人工日均，发布后该仓补货吃需求计划，不复制销售预测矩阵。
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>生成草稿</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">项目组</span>
              <Input
                className="h-9 w-40"
                value={projectGroup}
                placeholder="必填"
                onChange={(event) => setProjectGroup(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">仓库</span>
              <Input
                className="h-9 w-32 font-mono"
                value={warehouseCode}
                placeholder="US-WEST"
                onChange={(event) => setWarehouseCode(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">版本名称（可选）</span>
              <Input
                className="h-9 w-48"
                value={versionName}
                placeholder="默认用版本号"
                onChange={(event) => setVersionName(event.target.value)}
              />
            </label>
            <Button
              disabled={generate.isPending || !projectGroup.trim()}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? '生成中…' : '生成草稿'}
            </Button>
          </div>
          {generate.isError && (
            <p className="text-sm text-destructive">{mutationErrorMessage(generate.error)}</p>
          )}
          {generate.isSuccess && generate.data.skipped.length > 0 && (
            <p className="text-xs text-text-hint">已跳过 {generate.data.skipped.length} 个 SKU</p>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>版本列表</CardTitle>
          {adoption ? (
            <p className="text-sm font-normal text-text-sub">
              {adoption.source === 'demand_plan'
                ? `补货：周计划 ${adoptedVersionNo ?? ''}`.trim()
                : '补货：月预测'}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {versionsQuery.isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : versionsQuery.isError ? (
            <p className="text-sm text-destructive">{mutationErrorMessage(versionsQuery.error)}</p>
          ) : !versions.length ? (
            <p className="text-sm text-text-sub">暂无需求计划版本，请先生成草稿。</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">版本</th>
                    <th className="p-2 font-normal">项目组</th>
                    <th className="p-2 font-normal">仓库</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((version) => (
                    <VersionRow
                      key={version.id}
                      version={version}
                      selected={version.id === selectedId}
                      busy={
                        publish.isPending ||
                        archive.isPending ||
                        adoptWeekly.isPending ||
                        adoptMonthly.isPending
                      }
                      adoptedVersionId={
                        adoption?.source === 'demand_plan' &&
                        version.projectGroup === adoption.projectGroup &&
                        version.warehouseCode === adoption.warehouseCode
                          ? adoption.demandPlanVersionId
                          : null
                      }
                      onSelect={() => selectVersion(version.id)}
                      onPublish={() => publish.mutate({ id: version.id, adopt: false })}
                      onPublishAndAdopt={() => publish.mutate({ id: version.id, adopt: true })}
                      onAdoptWeekly={() => adoptWeekly.mutate(version.id)}
                      onAdoptMonthly={() =>
                        adoptMonthly.mutate({
                          projectGroup: version.projectGroup,
                          warehouseCode: version.warehouseCode,
                        })
                      }
                      onArchive={() => archive.mutate(version.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(publish.isError || archive.isError || adoptWeekly.isError || adoptMonthly.isError) && (
            <p className="mt-2 text-sm text-destructive">
              {mutationErrorMessage(
                publish.error ?? archive.error ?? adoptWeekly.error ?? adoptMonthly.error,
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {selectedId ? (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle>
              {grain === 'week' ? '周度明细' : '月度明细'}
              {selected ? (
                <span className="ml-2 text-sm font-normal text-text-sub">
                  {selected.versionNo} · {selected.projectGroup} · {selected.warehouseCode}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block max-w-xs space-y-1 text-sm">
              <span className="text-text-sub">SKU 筛选</span>
              <Input
                className="h-9 font-mono"
                value={skuFilter}
                placeholder="SKU 编码"
                onChange={(event) => setSkuFilter(event.target.value)}
              />
            </label>
            {detailQuery.isLoading ? (
              <p className="text-sm text-text-sub">加载明细中…</p>
            ) : detailQuery.isError ? (
              <p className="text-sm text-destructive">{mutationErrorMessage(detailQuery.error)}</p>
            ) : !filteredRows.length ? (
              <p className="text-sm text-text-sub">{grain === 'week' ? '暂无周度行。' : '暂无月度行。'}</p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-sub">
                      <th className="p-2 font-normal">SKU</th>
                      <th className="p-2 font-normal">{grain === 'week' ? '周' : '月'}</th>
                      <th className="p-2 font-normal">系统日均</th>
                      <th className="p-2 font-normal">人工日均</th>
                      <th className="p-2 font-normal">Champion</th>
                      <th className="p-2 font-normal">来源</th>
                      {isDraft ? <th className="p-2 font-normal">调整原因</th> : null}
                      {isDraft ? <th className="p-2 font-normal">操作</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const draft = edits[row.id];
                      return (
                        <tr key={row.id} className="border-b border-border/60">
                          <td className="p-2 font-mono">{row.skuCode ?? '—'}</td>
                          <td className="p-2 font-mono">{row.period}</td>
                          <td className="p-2 font-numeric">{formatDaily(row.systemDailyAvg)}</td>
                          <td className="p-2">
                            {isDraft ? (
                              <Input
                                className="h-8 w-28 font-numeric"
                                value={draft?.manual ?? row.manualDailyAvg ?? ''}
                                placeholder="空=系统值"
                                onChange={(event) =>
                                  setEdits((current) => ({
                                    ...current,
                                    [row.id]: {
                                      manual: event.target.value,
                                      reason: current[row.id]?.reason ?? row.adjustReason ?? '',
                                    },
                                  }))
                                }
                              />
                            ) : (
                              <span className="font-numeric">{formatDaily(row.manualDailyAvg)}</span>
                            )}
                          </td>
                          <td className="p-2 font-numeric">
                            {formatDaily(row.championForecastDaily)}
                          </td>
                          <td className="p-2 text-text-sub">{row.source}</td>
                          {isDraft ? (
                            <td className="p-2">
                              <Input
                                className="h-8 w-40"
                                value={draft?.reason ?? row.adjustReason ?? ''}
                                placeholder="改人工须填原因"
                                onChange={(event) =>
                                  setEdits((current) => ({
                                    ...current,
                                    [row.id]: {
                                      manual: current[row.id]?.manual ?? row.manualDailyAvg ?? '',
                                      reason: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </td>
                          ) : null}
                          {isDraft ? (
                            <td className="p-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={savePeriod.isPending}
                                onClick={() => saveRow(row)}
                              >
                                保存
                              </Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {savePeriod.isError && (
              <p className="text-sm text-destructive">{mutationErrorMessage(savePeriod.error)}</p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function VersionRow({
  version,
  selected,
  busy,
  adoptedVersionId,
  onSelect,
  onPublish,
  onPublishAndAdopt,
  onAdoptWeekly,
  onAdoptMonthly,
  onArchive,
}: {
  version: DemandPlanVersionListItem;
  selected: boolean;
  busy: boolean;
  adoptedVersionId: string | null;
  onSelect: () => void;
  onPublish: () => void;
  onPublishAndAdopt: () => void;
  onAdoptWeekly: () => void;
  onAdoptMonthly: () => void;
  onArchive: () => void;
}) {
  const isDraft = version.status === 'draft';
  const isPublished = version.status === 'pilot_published';
  return (
    <tr className={`border-b border-border/60 ${selected ? 'bg-highlight-warm/60' : ''}`}>
      <td className="p-2">
        <button type="button" className="text-left" onClick={onSelect}>
          <p className="font-medium text-text-main">{version.versionName}</p>
          <p className="font-mono text-xs text-text-sub">{version.versionNo}</p>
        </button>
      </td>
      <td className="p-2">{version.projectGroup}</td>
      <td className="p-2 font-mono">{version.warehouseCode}</td>
      <td className="p-2">
        <StatusBadge status={version.status} />
      </td>
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSelect}>
            明细
          </Button>
          {isDraft ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onPublish}>
              发布
            </Button>
          ) : null}
          {isDraft ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onPublishAndAdopt}>
              发布并采用
            </Button>
          ) : null}
          {isPublished && adoptedVersionId !== version.id ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onAdoptWeekly}>
              采用
            </Button>
          ) : null}
          {isPublished ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onAdoptMonthly}>
              采用月预测
            </Button>
          ) : null}
          {version.status !== 'archived' ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={onArchive}>
              归档
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
