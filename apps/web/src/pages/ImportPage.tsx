import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ImportType, type ImportValidationIssue, type BitableSyncType } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

type ImportTypeLocal = ImportType;

const TEMPLATES: Record<ImportTypeLocal, { title: string; hint: string; sample: string }> = {
  skus: {
    title: 'SKU 主数据',
    hint: '列：sku_code, name, unit, spu_code, spu_moq（主商品起订量）, category, lead_time_days, moq（SKU 起订量）, unit_cost, merchant_code, merchant_name, replenish_light（red/yellow/green）',
    sample: `sku_code,name,unit,spu_code,spu_moq,category,lead_time_days,moq,unit_cost,merchant_code,merchant_name,replenish_light
SKU-HM-001,硅胶厨房铲勺五件套,pcs,SPU-KIT-001,500,厨房收纳,25,500,8.5,M-HM-001,顺德家居供应链,red
SKU-HM-002,硅胶汤勺-薄荷绿,pcs,SPU-KIT-001,500,厨房收纳,25,500,2.8,M-HM-001,顺德家居供应链,yellow`,
  },
  inventory: {
    title: '库存盘点',
    hint: '物理仓列：sku_code, warehouse, qty_available, qty_in_transit, recorded_date；qty_in_production 写入 SKU 在产池（未分仓），也可单独导入 warehouse=IN-PRODUCTION',
    sample: `sku_code,warehouse,qty_available,qty_in_transit,qty_in_production,recorded_date
SKU-HM-001,US-WEST,500,200,100,2026-06-01
SKU-HM-003,IN-PRODUCTION,0,0,45,2026-06-01`,
  },
  sales: {
    title: '销量历史',
    hint: '列：sku_code, sale_date, qty_sold, channel, warehouse_code（实际发货仓）',
    sample: `sku_code,sale_date,qty_sold,channel,warehouse_code
SKU-HM-001,2026-05-01,120,wayfair,US-WEST
SKU-HM-003,2026-05-02,8,amazon,US-WEST`,
  },
  safety_stock: {
    title: '安全库存',
    hint: '列：sku_code, warehouse_code, safety_stock_qty, reorder_point, reorder_qty',
    sample: `sku_code,warehouse_code,safety_stock_qty,reorder_point,reorder_qty
SKU-HM-001,US-WEST,200,400,1000`,
  },
  pmc_plans: {
    title: '下单计划',
    hint: '列：sku_code, planned_qty, unit（可选）。需填写商家编号；计划名称/日期可在下方填写',
    sample: `sku_code,planned_qty,unit
SKU-HM-001,2000,pcs
SKU-HM-004,1500,pcs`,
  },
};

function parseImportType(value: string | null): ImportTypeLocal {
  if (value && value in TEMPLATES) return value as ImportTypeLocal;
  return 'inventory';
}

const BITABLE_SYNC_TYPES = new Set<BitableSyncType>(['skus', 'inventory', 'sales']);

function isBitableSyncType(type: ImportTypeLocal): type is BitableSyncType {
  return BITABLE_SYNC_TYPES.has(type as BitableSyncType);
}

function ValidationList({ issues }: { issues: ImportValidationIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="mb-2 font-medium">校验问题（{issues.length} 条）</p>
      <ul className="space-y-1">
        {issues.slice(0, 20).map((issue, i) => (
          <li key={i}>
            第 {issue.row} 行{issue.field ? ` [${issue.field}]` : ''}：{issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialType = parseImportType(searchParams.get('type'));
  const [importType, setImportType] = useState<ImportTypeLocal>(initialType);
  const [csv, setCsv] = useState(TEMPLATES[initialType].sample);
  const [result, setResult] = useState('');
  const [preview, setPreview] = useState<{
    rowCount: number;
    headers: string[];
    preview: Array<Record<string, string>>;
    validationIssues?: ImportValidationIssue[];
    hasBlockingIssues?: boolean;
  } | null>(null);
  const [planName, setPlanName] = useState('');
  const [merchantCode, setMerchantCode] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [planDate, setPlanDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState('');
  const [bitablePreviewReady, setBitablePreviewReady] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const bitableEnabled = isBitableSyncType(importType);

  const { data: bitableStatus } = useQuery({
    queryKey: ['bitable-status'],
    queryFn: () => api.getBitableStatus(),
    enabled: bitableEnabled,
  });

  const bitableConfigured = bitableEnabled ? (bitableStatus?.[importType]?.configured ?? false) : false;

  const { data: batches = [] } = useQuery({
    queryKey: ['import-batches', importType],
    queryFn: () => api.getImportBatches(importType),
    enabled: importType === 'inventory' || importType === 'sales',
  });

  const importText = useMutation({
    mutationFn: () =>
      api.importData(importType, {
        csv,
        planName: importType === 'pmc_plans' ? planName : undefined,
        planDate: importType === 'pmc_plans' ? planDate : undefined,
        deliveryDate: importType === 'pmc_plans' ? deliveryDate : undefined,
        merchantCode: importType === 'pmc_plans' ? merchantCode : undefined,
        merchantName: importType === 'pmc_plans' ? merchantName : undefined,
      }),
    onSuccess: (r) => {
      setResult(
        `导入 ${r.imported} 条；批次 ${r.batchStatus ?? '-'}；错误：${r.errors.join('; ') || '无'}`,
      );
      setPreview((prev) => ({ ...(prev ?? { rowCount: 0, headers: [], preview: [] }), validationIssues: r.validationIssues }));
    },
    onError: (err) => setResult((err as Error).message),
  });

  const previewImport = useMutation({
    mutationFn: () => api.previewImport(importType, { csv }),
    onSuccess: (r) => setPreview(r),
  });

  const importFile = useMutation({
    mutationFn: (file: File) =>
      api.importFile(importType, file, {
        planName,
        planDate,
        deliveryDate,
        merchantCode,
        merchantName,
      }),
    onSuccess: (r) => {
      setResult(
        `导入 ${r.imported} 条；批次 ${r.batchStatus ?? '-'}；错误：${r.errors.join('; ') || '无'}`,
      );
    },
    onError: (err) => setResult((err as Error).message),
  });

  const onTypeChange = (type: ImportTypeLocal) => {
    setImportType(type);
    setCsv(TEMPLATES[type].sample);
    setResult('');
    setPreview(null);
    setBitablePreviewReady(false);
  };

  const previewBitable = useMutation({
    mutationFn: () => api.previewBitableSync(importType as BitableSyncType),
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
    mutationFn: () => api.executeBitableSync(importType as BitableSyncType),
    onSuccess: (r) => {
      setResult(
        `多维表格同步 ${r.imported} 条；批次 ${r.batchStatus ?? '-'}；错误：${r.errors.join('; ') || '无'}`,
      );
      setBitablePreviewReady(false);
      if (importType === 'inventory' || importType === 'sales') {
        void queryClient.invalidateQueries({ queryKey: ['import-batches', importType] });
      }
    },
    onError: (err) => setResult((err as Error).message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="数据导入中心" />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TEMPLATES) as ImportTypeLocal[]).map((t) => (
          <Button
            key={t}
            variant={importType === t ? 'default' : 'outline'}
            size="sm"
            onClick={() => onTypeChange(t)}
          >
            {TEMPLATES[t].title}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{TEMPLATES[importType].title}</CardTitle>
          <p className="text-sm text-text-sub">{TEMPLATES[importType].hint}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {importType === 'pmc_plans' && (
            <div className="grid gap-2 md:grid-cols-5">
              <Input placeholder="商家编号 *" value={merchantCode} onChange={(e) => setMerchantCode(e.target.value)} />
              <Input placeholder="商家名称" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} />
              <Input placeholder="计划名称（可选）" value={planName} onChange={(e) => setPlanName(e.target.value)} />
              <Input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
              <Input type="date" placeholder="交期" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          )}

          <textarea
            className="h-36 w-full rounded-md border border-input bg-card p-3 font-mono text-sm"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => previewImport.mutate()} disabled={previewImport.isPending}>
              {previewImport.isPending ? '解析中...' : '预览并校验'}
            </Button>
            <Button onClick={() => importText.mutate()} disabled={importText.isPending}>
              {importText.isPending ? '导入中...' : '粘贴导入 (CSV)'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile.mutate(f);
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importFile.isPending}>
              {importFile.isPending ? '上传中...' : '上传文件 (CSV/XLSX)'}
            </Button>
          </div>

          {bitableEnabled && (
            <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/10 p-3">
              <p className="text-sm font-medium">飞书多维表格</p>
              <p className="text-xs text-text-sub">
                {bitableConfigured
                  ? `已配置表 ID：${bitableStatus?.[importType]?.tableId ?? '-'}`
                  : '未配置 FEISHU_BITABLE_APP_TOKEN 或对应 TABLE 环境变量，请在部署环境配置后重试'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => previewBitable.mutate()}
                  disabled={!bitableConfigured || previewBitable.isPending}
                >
                  {previewBitable.isPending ? '拉取中...' : '从多维表格预览'}
                </Button>
                <Button
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
                共 {preview.rowCount} 行，预览前 {preview.preview.length} 行
                {preview.hasBlockingIssues ? ' · 存在阻断性问题' : ''}
              </p>
              <ValidationList issues={preview.validationIssues ?? []} />
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{JSON.stringify(preview.preview, null, 2)}</pre>
            </div>
          )}

          {result && <p className="text-sm text-text-sub">{result}</p>}
        </CardContent>
      </Card>

      {(importType === 'inventory' || importType === 'sales') && batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>最近导入批次</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">时间</th>
                  <th className="p-2 font-normal">文件</th>
                  <th className="p-2 font-normal">状态</th>
                  <th className="p-2 font-normal">成功/总数</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-b border-border/60">
                    <td className="p-2">{String(batch.createdAt).slice(0, 19).replace('T', ' ')}</td>
                    <td className="p-2">{batch.fileName ?? '-'}</td>
                    <td className="p-2">{batch.status}</td>
                    <td className="p-2 font-numeric">
                      {batch.successCount}/{batch.rowCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
