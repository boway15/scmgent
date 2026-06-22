import { useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

type ImportType = 'skus' | 'inventory' | 'sales' | 'safety_stock' | 'pmc_plans' | 'compliance';

const TEMPLATES: Record<ImportType, { title: string; hint: string; sample: string }> = {
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
  compliance: {
    title: 'SKU 合规',
    hint: '列：sku_code, hs_code, origin_country, declared_value, weight_kg, length_cm, width_cm, height_cm, battery_type, is_liquid',
    sample: `sku_code,hs_code,origin_country,declared_value,weight_kg,length_cm,width_cm,height_cm,battery_type,is_liquid
SKU-HM-001,3924100000,CN,8.5,0.65,32,12,8,,false
SKU-HM-003,9401619000,CN,189,18.5,85,90,75,,false`,
  },
};

function parseImportType(value: string | null): ImportType {
  if (value && value in TEMPLATES) return value as ImportType;
  return 'inventory';
}

export function ImportPage() {
  const [searchParams] = useSearchParams();
  const initialType = parseImportType(searchParams.get('type'));
  const [importType, setImportType] = useState<ImportType>(initialType);
  const [csv, setCsv] = useState(TEMPLATES[initialType].sample);
  const [result, setResult] = useState('');
  const [preview, setPreview] = useState<{ rowCount: number; headers: string[]; preview: Array<Record<string, string>> } | null>(null);
  const [planName, setPlanName] = useState('');
  const [merchantCode, setMerchantCode] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [planDate, setPlanDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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
    onSuccess: (r) => setResult(`导入 ${r.imported} 条；错误：${r.errors.join('; ') || '无'}`),
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
    onSuccess: (r) => setResult(`导入 ${r.imported} 条；错误：${r.errors.join('; ') || '无'}`),
  });

  const onTypeChange = (type: ImportType) => {
    setImportType(type);
    setCsv(TEMPLATES[type].sample);
    setResult('');
    setPreview(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="数据导入中心" />
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TEMPLATES) as ImportType[]).map((t) => (
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
              {previewImport.isPending ? '解析中...' : '预览前 10 行'}
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

          {preview && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
              <p className="mb-2 text-text-sub">共 {preview.rowCount} 行，预览前 {preview.preview.length} 行</p>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">{JSON.stringify(preview.preview, null, 2)}</pre>
            </div>
          )}

          {result && <p className="text-sm text-text-sub">{result}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
