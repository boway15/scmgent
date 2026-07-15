import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ImportType, type ImportValidationIssue } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { bitableTypeForImport, formatImportResult, IMPORT_TEMPLATES } from './import-templates';
import { ValidationList } from './ValidationList';
import { ImportBatchTable } from './ImportBatchTable';
import { SalesImportPolicyNotice } from '@/components/SalesImportPolicyNotice';

type Props = {
  type: ImportType;
  onSuccess?: () => void;
};

export function ImportPanel({ type, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const template = IMPORT_TEMPLATES[type];
  const [csv, setCsv] = useState(template.sample);
  const [result, setResult] = useState('');
  const [preview, setPreview] = useState<{
    rowCount: number;
    headers: string[];
    preview: Array<Record<string, string>>;
    validationIssues?: ImportValidationIssue[];
    hasBlockingIssues?: boolean;
    salesDiagnostics?: {
      daily?: {
        expandedRowCount: number;
        skuCount: number;
        startDate?: string | null;
        endDate?: string | null;
      };
    };
  } | null>(null);
  const [planName, setPlanName] = useState('');
  const [merchantCode, setMerchantCode] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [planDate, setPlanDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState('');
  const [bitablePreviewReady, setBitablePreviewReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewFileRef = useRef<HTMLInputElement>(null);
  const [salesDailyFile, setSalesDailyFile] = useState<File | null>(null);

  const bitableType = bitableTypeForImport(type);
  const bitableEnabled = bitableType != null;

  useEffect(() => {
    setCsv(IMPORT_TEMPLATES[type].sample);
    setResult('');
    setPreview(null);
    setBitablePreviewReady(false);
    setSalesDailyFile(null);
    setPlanName('');
    setMerchantCode('');
    setMerchantName('');
    setPlanDate(new Date().toISOString().slice(0, 10));
    setDeliveryDate('');
  }, [type]);

  const { data: bitableStatus } = useQuery({
    queryKey: ['bitable-status'],
    queryFn: () => api.getBitableStatus(),
    enabled: bitableEnabled,
  });

  const bitableConfigured = bitableType
    ? (bitableStatus?.[bitableType]?.configured ?? false)
    : false;

  const handleSuccess = () => {
    onSuccess?.();
  };

  const importText = useMutation({
    mutationFn: () =>
      api.importData(type, {
        csv,
        planName: type === 'pmc_plans' ? planName : undefined,
        planDate: type === 'pmc_plans' ? planDate : undefined,
        deliveryDate: type === 'pmc_plans' ? deliveryDate : undefined,
        merchantCode: type === 'pmc_plans' ? merchantCode : undefined,
        merchantName: type === 'pmc_plans' ? merchantName : undefined,
      }),
    onSuccess: (r) => {
      setResult(formatImportResult(r));
      setPreview((prev) => ({
        ...(prev ?? { rowCount: 0, headers: [], preview: [] }),
        validationIssues: r.validationIssues,
      }));
      if (r.imported > 0 || r.batchStatus === 'success') handleSuccess();
    },
    onError: (err) => setResult((err as Error).message),
  });

  const previewImport = useMutation({
    mutationFn: () => api.previewImport(type, { csv }),
    onSuccess: (r) => setPreview(r),
  });

  const importFile = useMutation({
    mutationFn: (file: File) =>
      api.importFile(type, file, {
        planName,
        planDate,
        deliveryDate,
        merchantCode,
        merchantName,
      }),
    onSuccess: (r) => {
      if (r.async) {
        setResult(
          r.message ??
            `已提交后台导入 ${r.rowCount ?? ''} 行，请在下方「最近导入批次」查看进度（status=pending 表示进行中）`,
        );
        void queryClient.invalidateQueries({ queryKey: ['import-batches', type] });
        handleSuccess();
        return;
      }
      setResult(formatImportResult(r));
      void queryClient.invalidateQueries({ queryKey: ['import-batches', type] });
      if (r.imported > 0 || r.batchStatus === 'success') handleSuccess();
    },
    onError: (err) => {
      const msg = (err as Error).message ?? String(err);
      setResult(
        /failed to fetch/i.test(msg)
          ? '请求中断（Failed to fetch）：文件较大时导入已在后台进行，请刷新页面并查看下方「最近导入批次」。若批次为空，请重新上传文件。'
          : msg,
      );
    },
  });

  const previewSalesFiles = useMutation({
    mutationFn: () => api.previewSalesXiaoshouFiles({ dailyFile: salesDailyFile }),
    onSuccess: (r) => setPreview(r),
    onError: (err) => setResult((err as Error).message),
  });

  const importSalesFiles = useMutation({
    mutationFn: () => api.importSalesXiaoshouFiles({ dailyFile: salesDailyFile }),
    onSuccess: (r) => {
      if (r.async) {
        setResult(
          r.message ??
            `已提交后台导入 ${r.rowCount ?? ''} 行 SKU 宽表，请在下方「最近导入批次」查看进度`,
        );
        void queryClient.invalidateQueries({ queryKey: ['import-batches', type] });
        handleSuccess();
        return;
      }
      setResult(formatImportResult(r));
      void queryClient.invalidateQueries({ queryKey: ['import-batches', type] });
      if (r.imported > 0 || r.batchStatus === 'success') handleSuccess();
    },
    onError: (err) => {
      const msg = (err as Error).message ?? String(err);
      setResult(
        /failed to fetch/i.test(msg)
          ? '请求中断：大文件导入可能已在后台进行，请刷新并查看下方「最近导入批次」。'
          : msg,
      );
    },
  });

  const previewImportFile = useMutation({
    mutationFn: (file: File) => api.previewImportFile(type, file),
    onSuccess: (r) => setPreview(r),
    onError: (err) => setResult((err as Error).message),
  });

  const previewBitable = useMutation({
    mutationFn: () => api.previewBitableSync(bitableType!),
    onSuccess: (r) => {
      setPreview(r);
      setBitablePreviewReady(!r.hasBlockingIssues);
      setResult('');
    },
    onError: (err) => {
      setBitablePreviewReady(false);
      setResult((err as Error).message);
    },
  });

  const executeBitable = useMutation({
    mutationFn: () => api.executeBitableSync(bitableType!),
    onSuccess: (r) => {
      setResult(
        `多维表格同步 ${r.imported} 条；批次 ${r.batchStatus ?? '-'}；错误：${r.errors.join('; ') || '无'}`,
      );
      setBitablePreviewReady(false);
      if (type === 'inventory' || type === 'sales') {
        void queryClient.invalidateQueries({ queryKey: ['import-batches', type] });
      }
      if (r.imported > 0) handleSuccess();
    },
    onError: (err) => setResult((err as Error).message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-sub">{template.hint}</p>
      {type === 'sales' ? <SalesImportPolicyNotice /> : null}

      {type === 'pmc_plans' && (
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="商家编号 *" value={merchantCode} onChange={(e) => setMerchantCode(e.target.value)} />
          <Input placeholder="商家名称" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
          <Input placeholder="计划名称（可选）" value={planName} onChange={(e) => setPlanName(e.target.value)} />
          <Input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          <Input type="date" placeholder="交期" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </div>
      )}

      {type === 'sales' ? (
        <>
          <label className="block space-y-1 text-sm">
            <span className="text-text-sub">日销量宽表 CSV（产品销售报表-每日）</span>
            <Input
              type="file"
              accept=".csv,.txt"
              className="h-9"
              onChange={(e) => setSalesDailyFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => previewSalesFiles.mutate()}
              disabled={previewSalesFiles.isPending || !salesDailyFile}
            >
              {previewSalesFiles.isPending ? '解析中...' : '预览并校验'}
            </Button>
            <Button
              size="sm"
              onClick={() => importSalesFiles.mutate()}
              disabled={importSalesFiles.isPending || !salesDailyFile}
            >
              {importSalesFiles.isPending ? '提交中...' : '上传并导入'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <textarea
            className="h-32 w-full rounded-md border border-input bg-card p-3 font-mono text-sm"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => previewImport.mutate()} disabled={previewImport.isPending}>
              {previewImport.isPending ? '解析中...' : '预览并校验 (粘贴)'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => previewFileRef.current?.click()}
              disabled={previewImportFile.isPending}
            >
              {previewImportFile.isPending ? '解析文件中...' : '选择文件预览'}
            </Button>
            <Button size="sm" onClick={() => importText.mutate()} disabled={importText.isPending}>
              {importText.isPending ? '导入中...' : '粘贴导入 (CSV)'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importFile.isPending}>
              {importFile.isPending ? '提交中...' : '上传文件 (CSV/XLSX)'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile.mutate(f);
                e.target.value = '';
              }}
            />
            <input
              ref={previewFileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) previewImportFile.mutate(f);
                e.target.value = '';
              }}
            />
          </div>
        </>
      )}

      {bitableEnabled && (
        <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/10 p-3">
          <p className="text-sm font-medium">飞书多维表格</p>
          <p className="text-xs text-text-sub">
            {bitableConfigured
              ? `已配置表 ID：${bitableStatus?.[bitableType!]?.tableId ?? '-'}`
              : '未配置 FEISHU_BITABLE_APP_TOKEN 或对应 TABLE 环境变量，请在部署环境配置后重试'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => previewBitable.mutate()}
              disabled={!bitableConfigured || previewBitable.isPending}
            >
              {previewBitable.isPending ? '拉取中...' : '从多维表格预览'}
            </Button>
            <Button
              size="sm"
              onClick={() => executeBitable.mutate()}
              disabled={!bitableConfigured || !bitablePreviewReady || executeBitable.isPending}
            >
              {executeBitable.isPending ? '同步中...' : '确认从多维表格同步'}
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
          <p className="text-text-sub">
            {type === 'sales'
              ? `共 ${preview.rowCount} 行 SKU 宽表`
              : `共 ${preview.rowCount} 行，预览前 ${preview.preview.length} 行`}
            {preview.hasBlockingIssues ? ' · 存在阻断性问题' : ''}
          </p>
          {type === 'sales' && preview.salesDiagnostics?.daily && (
            <div className="space-y-1 text-xs text-text-sub">
              <p>
                预估日销量约 {preview.salesDiagnostics.daily.expandedRowCount.toLocaleString()} 条（由{' '}
                {preview.salesDiagnostics.daily.skuCount.toLocaleString()} 个 SKU 宽表行展开，非最终入库条数），日期{' '}
                {preview.salesDiagnostics.daily.startDate ?? '-'} → {preview.salesDiagnostics.daily.endDate ?? '-'}
              </p>
            </div>
          )}
          <ValidationList issues={preview.validationIssues ?? []} />
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs">
            {JSON.stringify(preview.preview, null, 2)}
          </pre>
        </div>
      )}

      {result && <p className="text-sm text-text-sub">{result}</p>}

      {(type === 'inventory' || type === 'sales') && (
        <ImportBatchTable
          type={type}
          onImportSettled={() => {
            if (type === 'sales') {
              void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
              void queryClient.invalidateQueries({ queryKey: ['sales-history-categories'] });
            }
          }}
        />
      )}
    </div>
  );
}
