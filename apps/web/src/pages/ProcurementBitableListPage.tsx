import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type ProcurementListMeta,
  type ProcurementListType,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatDateTimeCst } from '@/lib/utils';

type Props = {
  listType: ProcurementListType;
  title: string;
  description: string;
};

const SOURCE_LABELS: Record<string, string> = {
  feishu: '从飞书同步',
  upload: '文件上传',
  feishu_push: '同步到飞书',
  clear: '清空当前数据',
};

type PullPreview = {
  mode: 'pull';
  totalRows: number;
  columnOrder: string[];
  sample: Array<Record<string, string>>;
};

type PushPreview = {
  mode: 'push';
  localRowCount: number;
  feishuRowCount: number;
  toWrite: number;
  toDelete: number;
  columnOrder: string[];
  sample: Array<Record<string, string>>;
};

type UploadPreview = {
  mode: 'upload';
  totalRows: number;
  columnOrder: string[];
  sample: Array<Record<string, string>>;
};

type PreviewState = PullPreview | PushPreview | UploadPreview;

function cellValue(rowData: Record<string, string>, column: string): string {
  return rowData[column] ?? '';
}

export function ProcurementBitableListPage({ listType, title, description }: Props) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [message, setMessage] = useState('');

  const queryKey = ['procurement-list', listType, page, pageSize, appliedKeyword] as const;

  const { data: config } = useQuery({
    queryKey: ['procurement-list-config'],
    queryFn: () => api.getProcurementListConfig(),
  });

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      api.listProcurementRows({
        type: listType,
        page,
        pageSize,
        keyword: appliedKeyword || undefined,
      }),
  });

  const meta: ProcurementListMeta | undefined = data?.meta;
  const columns = data?.columns ?? meta?.columnOrder ?? [];
  const listConfig = config?.[listType];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['procurement-list', listType] });
    queryClient.invalidateQueries({ queryKey: ['procurement-list-config'] });
  };

  const pullPreview = useMutation({
    mutationFn: () => api.previewProcurementFeishuSync(listType),
    onSuccess: (result) => {
      setPreview({
        mode: 'pull',
        totalRows: result.totalRows,
        columnOrder: result.columnOrder,
        sample: result.sample,
      });
      setMessage('');
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const pullSync = useMutation({
    mutationFn: () => api.executeProcurementFeishuSync(listType),
    onSuccess: (result) => {
      setPreview(null);
      setMessage(`从飞书同步完成，已全量更新本地 ${result.imported} 行。`);
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const pushPreview = useMutation({
    mutationFn: () => api.previewProcurementFeishuPush(listType),
    onSuccess: (result) => {
      setPreview({
        mode: 'push',
        localRowCount: result.localRowCount,
        feishuRowCount: result.feishuRowCount,
        toWrite: result.toWrite,
        toDelete: result.toDelete,
        columnOrder: result.columnOrder,
        sample: result.sample,
      });
      setMessage('');
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const pushSync = useMutation({
    mutationFn: () => api.executeProcurementFeishuPush(listType),
    onSuccess: (result) => {
      setPreview(null);
      setMessage(`同步到飞书完成：已全量覆盖 ${result.created} 行（删除飞书原有 ${result.deleted} 行）。`);
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const uploadPreview = useMutation({
    mutationFn: (file: File) => api.previewProcurementUpload(listType, file),
    onSuccess: (result) => {
      setPreview({
        mode: 'upload',
        totalRows: result.totalRows,
        columnOrder: result.columnOrder,
        sample: result.sample,
      });
      setMessage('');
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const uploadImport = useMutation({
    mutationFn: (file: File) => api.executeProcurementUpload(listType, file),
    onSuccess: (result) => {
      setPreview(null);
      setImportFile(null);
      if (fileRef.current) fileRef.current.value = '';
      setMessage(`上传完成：已全量覆盖 ${result.imported} 行（字段列保持固定）。`);
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const clearLocal = useMutation({
    mutationFn: () => api.clearProcurementList(listType),
    onSuccess: (result) => {
      setPreview(null);
      setMessage(`已清空本地 ${result.deleted} 行。`);
      setPage(1);
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const displayColumns = columns;

  const handleSearch = () => {
    setAppliedKeyword(keyword.trim());
    setPage(1);
  };

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const previewTitle =
    preview?.mode === 'pull'
      ? `从飞书同步预览（${preview.totalRows} 行）`
      : preview?.mode === 'push'
        ? `同步到飞书预览（本地 ${preview.localRowCount} 行）`
        : preview?.mode === 'upload'
          ? `上传预览（${preview.totalRows} 行）`
          : '';

  const confirmPreview = () => {
    if (!preview) return;
    if (preview.mode === 'pull') {
      if (!window.confirm('将从飞书全量拉取并覆盖当前列表，是否继续？')) return;
      pullSync.mutate();
      return;
    }
    if (preview.mode === 'push') {
      if (
        !window.confirm(
          `将把本地 ${preview.localRowCount} 行全量覆盖到飞书（先删除飞书现有 ${preview.feishuRowCount} 行，再写入 ${preview.toWrite} 行），是否继续？`,
        )
      ) {
        return;
      }
      pushSync.mutate();
      return;
    }
    if (!window.confirm('文件上传将全量覆盖当前列表，是否继续？')) return;
    if (importFile) uploadImport.mutate(importFile);
  };

  return (
    <div className="space-y-4">
      <PageHeader title={title}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!listConfig?.configured || pullPreview.isPending}
            onClick={() => pullPreview.mutate()}
          >
            {pullPreview.isPending ? '预览中…' : '从飞书同步预览'}
          </Button>
          <Button
            disabled={!listConfig?.configured || pullSync.isPending}
            onClick={() => {
              if (window.confirm('将从飞书全量拉取并覆盖当前列表，是否继续？')) {
                pullSync.mutate();
              }
            }}
          >
            {pullSync.isPending ? '同步中…' : '从飞书同步'}
          </Button>
          <Button
            variant="outline"
            disabled={!listConfig?.configured || pushPreview.isPending}
            onClick={() => pushPreview.mutate()}
          >
            {pushPreview.isPending ? '预览中…' : '同步到飞书预览'}
          </Button>
          <Button
            disabled={!listConfig?.configured || pushSync.isPending || (meta?.rowCount ?? 0) === 0}
            onClick={() => {
              if (window.confirm('将把本地列表全量覆盖到飞书多维表格（先清空飞书表再写入），是否继续？')) {
                pushSync.mutate();
              }
            }}
          >
            {pushSync.isPending ? '推送中…' : '同步到飞书'}
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            {importFile ? `已选：${importFile.name}` : '选择 CSV/Excel'}
          </Button>
          <Button
            disabled={!importFile || uploadPreview.isPending}
            variant="outline"
            onClick={() => importFile && uploadPreview.mutate(importFile)}
          >
            {uploadPreview.isPending ? '预览中…' : '上传预览'}
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={clearLocal.isPending || (meta?.rowCount ?? 0) === 0}
            onClick={() => {
              const n = meta?.rowCount ?? 0;
              if (
                !window.confirm(
                  `将删除本地全部 ${n} 行数据，飞书多维表格不受影响。此操作不可恢复。确定清空？`,
                )
              ) {
                return;
              }
              clearLocal.mutate();
            }}
          >
            {clearLocal.isPending ? '清空中…' : '清空当前数据'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setImportFile(file);
              setPreview(null);
              setMessage('');
              if (file) uploadPreview.mutate(file);
            }}
          />
        </div>
      </PageHeader>

      <p className="text-sm text-text-sub">{description}</p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">数据状态</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-text-sub">
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
            <div>
              飞书配置：
              <span className={cn('ml-1', listConfig?.configured ? 'text-green-700' : 'text-amber-700')}>
                {listConfig?.configured ? '已配置' : '未配置'}
              </span>
            </div>
            <div>当前行数：{meta?.rowCount?.toLocaleString() ?? 0}</div>
            <div>
              最近更新：
              {meta?.lastSyncAt ? formatDateTimeCst(meta.lastSyncAt) : '暂无'}
              {meta?.lastSyncSource ? `（${SOURCE_LABELS[meta.lastSyncSource] ?? meta.lastSyncSource}）` : ''}
            </div>
            <div>更新人：{meta?.lastSyncByName ?? '—'}</div>
            {listConfig?.tableId ? <div className="md:col-span-2">飞书表 ID：{listConfig.tableId}</div> : null}
          </div>
          {listConfig && !listConfig.configured ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="font-medium">配置检查</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>
                  App Token（{listConfig.appTokenEnvKeys.join(' 或 ')}）：
                  {listConfig.appTokenConfigured ? '已设置' : '未设置'}
                </li>
                <li>
                  表 ID（{listConfig.tableEnvKey}）：
                  {listConfig.tableIdConfigured ? `已设置 (${listConfig.tableId})` : '未设置'}
                </li>
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {message ? (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-text-main">
          {message}
        </div>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{previewTitle}</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={pullSync.isPending || pushSync.isPending || uploadImport.isPending}
                onClick={confirmPreview}
              >
                确认执行
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.mode === 'push' ? (
              <p className="text-sm text-text-sub">
                全量覆盖：先删除飞书现有 {preview.feishuRowCount} 行，再写入本地 {preview.toWrite} 行
              </p>
            ) : (
              <p className="text-sm text-text-sub">
                列数 {preview.columnOrder.length}；以下为前 {Math.min(preview.sample.length, 5)} 行样例。
              </p>
            )}
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {preview.columnOrder.slice(0, 8).map((column) => (
                      <th key={column} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {preview.columnOrder.slice(0, 8).map((column) => (
                        <td key={column} className="max-w-[220px] truncate px-3 py-2" title={row[column]}>
                          {row[column] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base">列表数据</CardTitle>
          <div className="flex w-full max-w-md gap-2">
            <Input
              placeholder="搜索任意字段…"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSearch();
              }}
            />
            <Button variant="outline" onClick={handleSearch}>
              搜索
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : !data?.items.length ? (
            <p className="text-sm text-text-sub">暂无数据，请先「从飞书同步」或上传文件导入。</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">#</th>
                    {displayColumns.map((column) => (
                      <th key={column} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-2 text-text-sub">{row.rowIndex + 1}</td>
                      {displayColumns.map((column) => (
                        <td
                          key={column}
                          className="max-w-[240px] truncate px-3 py-2"
                          title={cellValue(row.rowData, column)}
                        >
                          {cellValue(row.rowData, column) || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.total > 0 ? (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
