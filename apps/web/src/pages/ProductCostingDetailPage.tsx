import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type CostingBomConfidence,
  type CostingBomLine,
  type CostingProjectStatus,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<CostingProjectStatus, string> = {
  draft: '草稿',
  extracting: 'AI 拆解中',
  bom_draft: '清单待确认',
  bom_ready: '清单已确认',
  costed: '已核算',
  extract_failed: '拆解失败',
};

type TabKey = 'design' | 'bom';

export function ProductCostingDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<TabKey>('design');
  const [message, setMessage] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [draftLines, setDraftLines] = useState<CostingBomLine[]>([]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['product-costing', id],
    queryFn: () => api.getProductCosting(id),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'extracting' ? 2000 : false),
  });

  useEffect(() => {
    if (data?.lines) setDraftLines(data.lines);
  }, [data?.lines]);

  const { data: run } = useQuery({
    queryKey: ['product-costing-run', id, runId],
    queryFn: () => api.getProductCostingExtractRun(id, runId!),
    enabled: !!id && !!runId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'pending' || s === 'running' ? 1500 : false;
    },
  });

  useEffect(() => {
    if (run?.status === 'succeeded' || run?.status === 'failed') {
      void refetch();
      if (run.status === 'succeeded') {
        setMessage('AI 拆解完成，请校对清单');
        setTab('bom');
      } else {
        setMessage(run.errorMessage || 'AI 拆解失败');
      }
    }
  }, [run?.status, run?.errorMessage, refetch]);

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadProductCostingAttachment(id, file),
    onSuccess: () => {
      setMessage('方案已上传');
      qc.invalidateQueries({ queryKey: ['product-costing', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const extract = useMutation({
    mutationFn: () => api.startProductCostingExtract(id),
    onSuccess: (res) => {
      setRunId(res.runId);
      setMessage('已开始 AI 拆解…');
      qc.invalidateQueries({ queryKey: ['product-costing', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const saveLines = useMutation({
    mutationFn: () =>
      api.replaceProductCostingBomLines(
        id,
        draftLines.map((l) => ({
          category: l.category,
          materialName: l.materialName,
          spec: l.spec,
          unit: l.unit,
          qtyNet: Number(l.qtyNet),
          lossRate: Number(l.lossRate),
          sourceRef: l.sourceRef,
          confidence: l.confidence,
          notes: l.notes,
          isManual: true,
        })),
      ),
    onSuccess: () => {
      setMessage('清单已保存');
      qc.invalidateQueries({ queryKey: ['product-costing', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const confirm = useMutation({
    mutationFn: async (force: boolean) => {
      // 先落库当前编辑，避免只改了置信度未保存导致确认仍按旧数据拦截
      await api.replaceProductCostingBomLines(
        id,
        draftLines.map((l) => ({
          category: l.category,
          materialName: l.materialName,
          spec: l.spec,
          unit: l.unit,
          qtyNet: Number(l.qtyNet),
          lossRate: Number(l.lossRate),
          sourceRef: l.sourceRef,
          confidence: l.confidence,
          notes: l.notes,
          isManual: true,
        })),
      );
      return api.confirmProductCostingBom(id, force);
    },
    onSuccess: () => {
      setMessage('清单已确认');
      qc.invalidateQueries({ queryKey: ['product-costing', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const pageNos = useMemo(() => {
    const set = new Set<number>();
    for (const a of data?.attachments ?? []) {
      if (a.kind === 'page_image' && a.pageNo) set.add(a.pageNo);
    }
    return [...set].sort((a, b) => a - b);
  }, [data?.attachments]);

  if (isLoading || !data) {
    return <p className="text-text-sub">加载中…</p>;
  }

  const updateLine = (lineId: string, patch: Partial<CostingBomLine>) => {
    setDraftLines((rows) => rows.map((r) => (r.id === lineId ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={data.name}
        description={`${data.projectNo} · ${STATUS_LABEL[data.status]}${
          data.category ? ` · ${data.category}` : ''
        }`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link to="/procurement/costing" className="text-sm text-brand hover:underline">
          ← 返回列表
        </Link>
        <div className="ml-auto flex gap-2">
          <Button
            variant={tab === 'design' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('design')}
          >
            方案
          </Button>
          <Button
            variant={tab === 'bom' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('bom')}
          >
            清单
          </Button>
        </div>
      </div>

      {message && (
        <p className="rounded border border-border bg-muted/40 px-3 py-2 text-sm text-text-main">
          {message}
        </p>
      )}
      {data.extractError && data.status === 'extract_failed' && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {data.extractError}
        </p>
      )}

      {tab === 'design' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">设计方案</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".pptx,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = '';
                }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                {upload.isPending ? '上传中…' : '上传 PPT/PDF'}
              </Button>
              <Button
                onClick={() => extract.mutate()}
                disabled={!data.hasSource || extract.isPending || data.status === 'extracting'}
              >
                {data.status === 'extracting' || extract.isPending ? '拆解中…' : 'AI 拆解清单'}
              </Button>
              <span className="text-sm text-text-hint">
                {data.hasSource ? '已上传方案原件' : '尚未上传方案'}
                {pageNos.length ? ` · 已预处理 ${pageNos.length} 页` : ''}
              </span>
            </div>
            {pageNos.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {pageNos.map((n) => (
                  <figure key={n} className="overflow-hidden rounded border border-border">
                    <img
                      src={api.productCostingPageUrl(id, n)}
                      alt={`第 ${n} 页`}
                      className="h-40 w-full object-contain bg-white"
                    />
                    <figcaption className="border-t px-2 py-1 text-xs text-text-sub">
                      第 {n} 页
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'bom' && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">原材料清单</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraftLines((rows) => [
                    ...rows,
                    {
                      id: `tmp-${Date.now()}`,
                      projectId: id,
                      lineNo: rows.length + 1,
                      category: '未分类',
                      materialName: '',
                      spec: '',
                      unit: '个',
                      qtyNet: '1',
                      lossRate: '0',
                      qtyGross: '1',
                      sourceRef: '',
                      confidence: 'medium',
                      notes: '',
                      isManual: true,
                    },
                  ])
                }
              >
                增行
              </Button>
              <Button size="sm" variant="outline" onClick={() => saveLines.mutate()} disabled={saveLines.isPending}>
                保存
              </Button>
              <Button
                size="sm"
                onClick={() => confirm.mutate(false)}
                disabled={confirm.isPending || data.status === 'bom_ready'}
                title="要求无 low 置信度且物料/单位/用量齐全"
              >
                确认清单
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={confirm.isPending || data.status === 'bom_ready'}
                onClick={() => {
                  const lowCount = draftLines.filter((l) => l.confidence === 'low').length;
                  const tip =
                    lowCount > 0
                      ? `当前有 ${lowCount} 行置信度为 low（表格中标红）。确认已人工核对后强制确认？`
                      : '确认清单内容无误并强制确认？';
                  if (window.confirm(tip)) confirm.mutate(true);
                }}
              >
                强制确认
              </Button>
              <Button size="sm" variant="outline" onClick={() => api.exportProductCostingBom(id)}>
                导出 Excel
              </Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-2">大类</th>
                  <th className="py-2 pr-2">物料</th>
                  <th className="py-2 pr-2">规格</th>
                  <th className="py-2 pr-2">单位</th>
                  <th className="py-2 pr-2">净用量</th>
                  <th className="py-2 pr-2">损耗</th>
                  <th className="py-2 pr-2">毛用量</th>
                  <th className="py-2 pr-2">来源</th>
                  <th className="py-2 pr-2">置信度</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {draftLines.map((line) => {
                  const low = line.confidence === 'low';
                  const qtyNet = Number(line.qtyNet) || 0;
                  const loss = Number(line.lossRate) || 0;
                  const gross = Math.round(qtyNet * (1 + loss) * 10000) / 10000;
                  return (
                    <tr
                      key={line.id}
                      className={cn('border-b border-border/50', low && 'bg-red-50/80')}
                    >
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 min-w-[72px]"
                          value={line.category}
                          onChange={(e) => updateLine(line.id, { category: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 min-w-[100px]"
                          value={line.materialName}
                          onChange={(e) => updateLine(line.id, { materialName: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 min-w-[100px]"
                          value={line.spec ?? ''}
                          onChange={(e) => updateLine(line.id, { spec: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-16"
                          value={line.unit}
                          onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-20"
                          value={line.qtyNet}
                          onChange={(e) => updateLine(line.id, { qtyNet: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-20"
                          value={line.lossRate}
                          onChange={(e) => updateLine(line.id, { lossRate: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2 text-text-sub">{gross}</td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-8 w-20"
                          value={line.sourceRef ?? ''}
                          onChange={(e) => updateLine(line.id, { sourceRef: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          className="h-8 rounded border border-border bg-white px-1"
                          value={line.confidence}
                          onChange={(e) =>
                            updateLine(line.id, {
                              confidence: e.target.value as CostingBomConfidence,
                            })
                          }
                        >
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="low">low</option>
                        </select>
                      </td>
                      <td className="py-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() =>
                            setDraftLines((rows) => rows.filter((r) => r.id !== line.id))
                          }
                        >
                          删
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!draftLines.length && (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-text-hint">
                      暂无清单行。可先 AI 拆解，或手动增行。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
