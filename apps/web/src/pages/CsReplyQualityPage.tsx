import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CsReplyRecordSummary } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatDateTimeCst } from '@/lib/utils';

const SCORE_STATUS_LABELS: Record<string, string> = {
  pending: '待评分',
  scoring: '评分中',
  scored: '已评分',
  failed: '失败',
  skipped: '跳过',
};

const BATCH_STATUS_LABELS: Record<string, string> = {
  importing: '导入中',
  imported: '已导入',
  scoring: '评分中',
  completed: '已完成',
  failed: '失败',
};

const DIMENSION_LABELS: Record<string, string> = {
  accuracy: '准确性',
  professionalism: '专业性',
  empathy: '共情',
  resolution: '解决度',
};

function scoreBadgeClass(score: number | null | undefined, pass?: boolean | null): string {
  if (score == null) return 'bg-muted text-text-sub';
  if (pass === false) return 'bg-red-50 text-red-700';
  if (score >= 85) return 'bg-green-50 text-green-700';
  if (score >= 70) return 'bg-amber-50 text-amber-700';
  return 'bg-red-50 text-red-700';
}

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

export function CsReplyQualityPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [agentName, setAgentName] = useState('');
  const [messageType, setMessageType] = useState('');
  const [scoreStatus, setScoreStatus] = useState('');
  const [batchId, setBatchId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [minScore, setMinScore] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [applied, setApplied] = useState({
    agentName: '',
    messageType: '',
    scoreStatus: '',
    batchId: '',
    keyword: '',
    minScore: '',
    maxScore: '',
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState('');
  const [passThreshold, setPassThreshold] = useState('70');
  const [autoScore, setAutoScore] = useState(true);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewCsReplyImport>> | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<CsReplyRecordSummary | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['cs-reply-status'],
    queryFn: () => api.getCsReplyQualityStatus(),
  });

  const { data: overview } = useQuery({
    queryKey: ['cs-reply-overview'],
    queryFn: () => api.getCsReplyQualityOverview(),
    refetchInterval: 10000,
  });

  const { data: batches } = useQuery({
    queryKey: ['cs-reply-batches'],
    queryFn: () => api.getCsReplyBatches(),
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((b) => b.status === 'importing' || b.status === 'scoring')
        ? 5000
        : false,
  });

  const { data: agents } = useQuery({
    queryKey: ['cs-reply-agents'],
    queryFn: () => api.getCsReplyAgents(),
  });

  const { data: records, isLoading } = useQuery({
    queryKey: ['cs-reply-records', page, pageSize, applied],
    queryFn: () =>
      api.getCsReplyRecords({
        page,
        pageSize,
        agentName: applied.agentName || undefined,
        messageType: applied.messageType || undefined,
        scoreStatus: applied.scoreStatus || undefined,
        batchId: applied.batchId || undefined,
        keyword: applied.keyword || undefined,
        minScore: applied.minScore ? Number(applied.minScore) : undefined,
        maxScore: applied.maxScore ? Number(applied.maxScore) : undefined,
      }),
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some(
        (r) => r.scoreStatus === 'pending' || r.scoreStatus === 'scoring',
      )
        ? 5000
        : false,
  });

  const previewMutation = useMutation({
    mutationFn: (file: File) => api.previewCsReplyImport(file),
    onSuccess: (data) => setPreview(data),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      if (!importFile) throw new Error('请选择文件');
      return api.importCsReplyFile({
        file: importFile,
        name: importName.trim() || undefined,
        passThreshold: Number(passThreshold) || 70,
        autoScore,
      });
    },
    onSuccess: () => {
      setImportOpen(false);
      setImportFile(null);
      setPreview(null);
      setImportName('');
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-records'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-overview'] });
    },
  });

  const scoreBatchMutation = useMutation({
    mutationFn: (params: { batchId: string; rescore?: boolean }) =>
      api.scoreCsReplyBatch(params.batchId, params.rescore),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-records'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-overview'] });
    },
  });

  const rescoreMutation = useMutation({
    mutationFn: (recordId: string) => api.rescoreCsReplyRecord(recordId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-records'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-overview'] });
    },
  });

  const clearMutation = useMutation({
    mutationFn: (params?: { batchId?: string }) => api.clearCsReplyData(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-batches'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-records'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['cs-reply-agents'] });
    },
  });

  function confirmClear(batchId?: string) {
    const label = batchId ? '该批次及其全部记录' : '全部客服导入数据';
    if (!window.confirm(`确定清除${label}？此操作不可恢复。`)) return;
    clearMutation.mutate(batchId ? { batchId } : undefined);
  }

  async function handleExport() {
    setExporting(true);
    try {
      await api.exportCsReplyRecords({
        batchId: applied.batchId || undefined,
        agentName: applied.agentName || undefined,
        messageType: applied.messageType || undefined,
        scoreStatus: applied.scoreStatus || undefined,
        keyword: applied.keyword || undefined,
        minScore: applied.minScore ? Number(applied.minScore) : undefined,
        maxScore: applied.maxScore ? Number(applied.maxScore) : undefined,
      });
    } finally {
      setExporting(false);
    }
  }

  const activeBatch = useMemo(
    () => (batches?.items ?? []).find((b) => b.status === 'importing' || b.status === 'scoring'),
    [batches],
  );

  const items = records?.items ?? [];
  const total = records?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="回复评分">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            导入 Excel
          </Button>
          <Button
            variant="outline"
            disabled={exporting || (overview?.totalRecords ?? 0) === 0}
            onClick={() => void handleExport()}
          >
            {exporting ? '导出中…' : '导出评分'}
          </Button>
          <Button
            variant="outline"
            disabled={clearMutation.isPending || (overview?.totalRecords ?? 0) === 0}
            onClick={() => confirmClear()}
          >
            清除全部数据
          </Button>
          {activeBatch && (
            <Button
              variant="outline"
              disabled={scoreBatchMutation.isPending || activeBatch.status === 'scoring'}
              onClick={() => scoreBatchMutation.mutate({ batchId: activeBatch.id })}
            >
              继续评分
            </Button>
          )}
        </div>
      </PageHeader>

      <p className="-mt-4 text-sm text-text-sub">
        上传买家消息 Excel，由 Dify 工作流评估客服英文回复质量。
        {status?.difyEnabled ? (
          <span className="ml-2 text-green-700">
            Dify 已连接 · {status.difyAppName}（workflow）
          </span>
        ) : status?.difyMessage ? (
          <span className="ml-2 text-amber-700">{status.difyMessage}</span>
        ) : (
          <span className="ml-2 text-amber-700">Dify 未配置，请设置 DIFY_API_KEY_CS_REPLY_QUALITY</span>
        )}
      </p>

      {activeBatch && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 text-sm">
            批次 {activeBatch.batchNo} · {BATCH_STATUS_LABELS[activeBatch.status] ?? activeBatch.status}
            {' · '}
            已导入 {activeBatch.importedRows}/{activeBatch.totalRows}
            {' · '}
            已评分 {activeBatch.scoredRows}
            {activeBatch.failedRows > 0 ? ` · 失败 ${activeBatch.failedRows}` : ''}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">总记录</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.totalRecords ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">已评分</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.scoredRecords ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">平均分</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.avgScore ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">及格率</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.passRate ?? 0}%</CardContent>
        </Card>
      </div>

      {overview?.topAgents && overview.topAgents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">客服均分 TOP</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {overview.topAgents.map((agent) => (
                <button
                  key={agent.agentName}
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  onClick={() => {
                    setAgentName(agent.agentName);
                    setApplied((prev) => ({ ...prev, agentName: agent.agentName }));
                    setPage(1);
                  }}
                >
                  {agent.agentName} · {agent.avgScore} 分 · {agent.count} 条
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Input placeholder="关键词（消息/订单号）" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
          >
            <option value="">全部客服</option>
            {(agents?.items ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={messageType}
            onChange={(e) => setMessageType(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="售前">售前</option>
            <option value="售后">售后</option>
          </select>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={scoreStatus}
            onChange={(e) => setScoreStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            {Object.entries(SCORE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm md:col-span-2"
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
          >
            <option value="">全部批次</option>
            {(batches?.items ?? []).map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.batchNo} · {batch.name ?? '未命名'} · {BATCH_STATUS_LABELS[batch.status] ?? batch.status}
              </option>
            ))}
          </select>
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="最低分"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="最高分"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
          />
          <div className="flex gap-2 md:col-span-4">
            <Button
              onClick={() => {
                setApplied({ agentName, messageType, scoreStatus, batchId, keyword, minScore, maxScore });
                setPage(1);
              }}
            >
              查询
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setAgentName('');
                setMessageType('');
                setScoreStatus('');
                setBatchId('');
                setKeyword('');
                setMinScore('');
                setMaxScore('');
                setApplied({
                  agentName: '',
                  messageType: '',
                  scoreStatus: '',
                  batchId: '',
                  keyword: '',
                  minScore: '',
                  maxScore: '',
                });
                setPage(1);
              }}
            >
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">回复记录</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-text-sub">暂无数据，请先导入 Excel。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] table-fixed text-sm">
                <colgroup>
                  <col style={{ width: '158px' }} />
                  <col style={{ width: '76px' }} />
                  <col style={{ width: '52px' }} />
                  <col />
                  <col />
                  <col style={{ width: '56px' }} />
                  <col style={{ width: '68px' }} />
                  <col style={{ width: '88px' }} />
                </colgroup>
                <thead>
                  <tr className="border-b text-left text-text-sub">
                    <th className="px-2 py-2">时间</th>
                    <th className="px-2 py-2">客服</th>
                    <th className="px-2 py-2">类型</th>
                    <th className="px-2 py-2">买家消息</th>
                    <th className="px-2 py-2">客服回复</th>
                    <th className="px-2 py-2">评分</th>
                    <th className="px-2 py-2">状态</th>
                    <th className="px-2 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b align-top hover:bg-muted/40">
                      <td className="px-2 py-2 text-xs leading-snug whitespace-nowrap">
                        {formatDateTimeCst(row.sentAt)}
                      </td>
                      <td className="px-2 py-2 truncate text-xs" title={row.agentName ?? ''}>
                        {row.agentName || '-'}
                      </td>
                      <td className="px-2 py-2 text-xs">{row.messageType || '-'}</td>
                      <td className="px-2 py-2 break-words text-xs leading-snug">
                        {truncate(row.buyerMessage, 120)}
                      </td>
                      <td className="px-2 py-2 break-words text-xs leading-snug">
                        {truncate(row.agentReply, 120)}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={cn(
                            'inline-flex rounded px-1.5 py-0.5 text-xs font-medium',
                            scoreBadgeClass(row.overallScore, row.pass),
                          )}
                          title={row.errorMessage ?? undefined}
                        >
                          {row.scoreStatus === 'failed' && row.overallScore == null
                            ? '失败'
                            : (row.overallScore ?? '-')}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        {SCORE_STATUS_LABELS[row.scoreStatus] ?? row.scoreStatus}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => setSelectedRecord(row)}
                          >
                            详情
                          </button>
                          <button
                            type="button"
                            className="text-primary hover:underline disabled:opacity-50"
                            disabled={rescoreMutation.isPending || !status?.difyEnabled}
                            onClick={() => rescoreMutation.mutate(row.id)}
                          >
                            重评
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">导入批次</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(batches?.items ?? []).length === 0 ? (
            <p className="text-sm text-text-sub">暂无导入批次</p>
          ) : (
            (batches?.items ?? []).map((batch) => (
              <div
                key={batch.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{batch.batchNo}</span>
                  <span className="mx-2 text-text-sub">{batch.name}</span>
                  <span>{BATCH_STATUS_LABELS[batch.status] ?? batch.status}</span>
                  <span className="mx-2 text-text-sub">
                    {batch.scoredRows}/{batch.importedRows} 已评分 · 及格线 {batch.passThreshold}
                  </span>
                  {batch.errorSummary && (
                    <span className="block text-xs text-amber-700">{batch.errorSummary}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!status?.difyEnabled || scoreBatchMutation.isPending}
                    onClick={() => scoreBatchMutation.mutate({ batchId: batch.id })}
                  >
                    评分待处理
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!status?.difyEnabled || scoreBatchMutation.isPending}
                    onClick={() => scoreBatchMutation.mutate({ batchId: batch.id, rescore: true })}
                  >
                    全部重评
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={clearMutation.isPending}
                    onClick={() => confirmClear(batch.id)}
                  >
                    删除批次
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-background p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">导入客服消息 Excel</h2>
            <p className="mb-4 text-sm text-text-sub">
              列名：买家邮箱、发送时间、回复人、消息类型、订单号、买家消息、客服回复（参考样例文件）
            </p>
            <div className="space-y-3">
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setImportFile(file);
                  setPreview(null);
                  if (file) previewMutation.mutate(file);
                }}
              />
              <Input
                placeholder="批次名称（可选）"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  placeholder="及格线"
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoScore}
                    onChange={(e) => setAutoScore(e.target.checked)}
                  />
                  导入后自动评分
                </label>
              </div>
              {previewMutation.isPending && <p className="text-sm text-text-sub">预览解析中…</p>}
              {preview && (
                <div className="rounded-md border p-3 text-sm">
                  <p>共 {preview.totalRows} 行，有效 {preview.validRows} 行，跳过 {preview.issueCount} 行</p>
                  {preview.issues.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-amber-700">
                      {preview.issues.slice(0, 5).map((issue) => (
                        <li key={`${issue.row}-${issue.message}`}>
                          第 {issue.row} 行：{issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)}>
                取消
              </Button>
              <Button
                disabled={!importFile || importMutation.isPending || previewMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? '导入中…' : '确认导入'}
              </Button>
            </div>
            {importMutation.isError && (
              <p className="mt-2 text-sm text-red-600">
                {importMutation.error instanceof Error ? importMutation.error.message : '导入失败'}
              </p>
            )}
          </div>
        </div>
      )}

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-background p-6 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">回复详情</h2>
                <p className="text-sm text-text-sub">
                  {selectedRecord.agentName || '-'} · {selectedRecord.messageType || '-'} ·{' '}
                  {formatDateTimeCst(selectedRecord.sentAt)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedRecord(null)}>
                关闭
              </Button>
            </div>

            <div className="mb-4 flex items-center gap-3">
              <span
                className={cn(
                  'rounded px-3 py-1 text-lg font-semibold',
                  scoreBadgeClass(selectedRecord.overallScore, selectedRecord.pass),
                )}
              >
                {selectedRecord.overallScore ?? '未评分'}
              </span>
              <span className="text-sm text-text-sub">
                {SCORE_STATUS_LABELS[selectedRecord.scoreStatus] ?? selectedRecord.scoreStatus}
              </span>
            </div>

            {selectedRecord.scoreDetail && (
              <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                {Object.entries(selectedRecord.scoreDetail).map(([key, value]) => (
                  <div key={key} className="rounded border px-3 py-2 text-sm">
                    <div className="text-text-sub">{DIMENSION_LABELS[key] ?? key}</div>
                    <div className="text-lg font-semibold">{value}</div>
                  </div>
                ))}
              </div>
            )}

            {selectedRecord.feedback && (
              <div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="mb-1 font-medium">AI 评语</div>
                <p className="whitespace-pre-wrap">{selectedRecord.feedback}</p>
              </div>
            )}

            <div className="mb-4 space-y-3">
              <div>
                <div className="mb-1 text-sm font-medium">买家消息</div>
                <div className="rounded border p-3 text-sm whitespace-pre-wrap">{selectedRecord.buyerMessage}</div>
              </div>
              <div>
                <div className="mb-1 text-sm font-medium">客服回复</div>
                <div className="rounded border p-3 text-sm whitespace-pre-wrap">{selectedRecord.agentReply}</div>
              </div>
            </div>

            {selectedRecord.errorMessage && (
              <p className="text-sm text-red-600">{selectedRecord.errorMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
