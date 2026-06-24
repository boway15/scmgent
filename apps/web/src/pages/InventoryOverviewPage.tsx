import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ReplenishLightBadge } from '@/components/ReplenishLightBadge';
import { InventoryHealthBadge } from '@/components/InventoryHealthBadge';
import { useState } from 'react';

const IN_PRODUCTION_WAREHOUSE = 'IN-PRODUCTION';

const STATUS_LABEL: Record<string, string> = {
  normal: '正常',
  alert: '预警',
  danger: '危险',
  stockout: '缺货',
};

const STATUS_COLOR: Record<string, string> = {
  normal: 'text-text-main',
  alert: 'text-amber-600',
  danger: 'text-orange-600',
  stockout: 'text-primary font-semibold',
};

export function InventoryOverviewPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['inventory-overview'],
    queryFn: api.getInventoryOverview,
  });
  const { data: skus = [] } = useQuery({ queryKey: ['skus'], queryFn: api.getSkus });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: api.getWarehouses });

  const [showForm, setShowForm] = useState(false);
  const [skuForm, setSkuForm] = useState({
    code: '',
    name: '',
    unit: 'pcs',
    category: '',
    leadTimeDays: 30,
    moq: 0,
    unitCost: 0,
    merchantCode: '',
    merchantName: '',
  });
  const [invForm, setInvForm] = useState({
    skuId: '',
    warehouse: 'US-WEST',
    qtyAvailable: 0,
    qtyInTransit: 0,
    recordedDate: new Date().toISOString().slice(0, 10),
  });
  const [productionForm, setProductionForm] = useState({
    skuId: '',
    qtyInProduction: 0,
    recordedDate: new Date().toISOString().slice(0, 10),
  });

  const createSku = useMutation({
    mutationFn: () => api.createSku(skuForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skus'] });
      qc.invalidateQueries({ queryKey: ['inventory-overview'] });
      setShowForm(false);
    },
  });

  const createInv = useMutation({
    mutationFn: () => api.createInventoryRecord(invForm),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-overview'] }),
  });

  const createProduction = useMutation({
    mutationFn: () =>
      api.createInventoryRecord({
        skuId: productionForm.skuId,
        warehouse: IN_PRODUCTION_WAREHOUSE,
        qtyInProduction: productionForm.qtyInProduction,
        recordedDate: productionForm.recordedDate,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-overview'] }),
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="库存总览">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => api.exportInventoryCsv()}>
            导出 CSV
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>{showForm ? '取消' : '新建 SKU'}</Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>SKU 列表</CardTitle>
          <p className="text-sm text-text-sub">
            本仓有效 = 可售 + 在途。健康灯：蓝=超多、绿=健康、黄=有风险、红=必须补货、灰=滞销/停售；补货灯（红/黄/绿）控制是否参与自动补货建议
          </p>
        </CardHeader>
        <CardContent>
          {showForm && (
            <div className="mb-4 grid gap-2 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-4 lg:grid-cols-10">
              <Input placeholder="SKU 编号" value={skuForm.code} onChange={(e) => setSkuForm({ ...skuForm, code: e.target.value })} />
              <Input placeholder="名称" value={skuForm.name} onChange={(e) => setSkuForm({ ...skuForm, name: e.target.value })} />
              <Input placeholder="单位" value={skuForm.unit} onChange={(e) => setSkuForm({ ...skuForm, unit: e.target.value })} />
              <Input placeholder="品类" value={skuForm.category} onChange={(e) => setSkuForm({ ...skuForm, category: e.target.value })} />
              <Input placeholder="商家编号" value={skuForm.merchantCode} onChange={(e) => setSkuForm({ ...skuForm, merchantCode: e.target.value })} />
              <Input placeholder="商家名称" value={skuForm.merchantName} onChange={(e) => setSkuForm({ ...skuForm, merchantName: e.target.value })} />
              <Input type="number" placeholder="交期(天)" value={skuForm.leadTimeDays} onChange={(e) => setSkuForm({ ...skuForm, leadTimeDays: +e.target.value })} />
              <Input type="number" placeholder="MOQ" value={skuForm.moq} onChange={(e) => setSkuForm({ ...skuForm, moq: +e.target.value })} />
              <Input type="number" placeholder="单价" value={skuForm.unitCost} onChange={(e) => setSkuForm({ ...skuForm, unitCost: +e.target.value })} />
              <Button variant="outline" onClick={() => createSku.mutate()} disabled={createSku.isPending}>
                保存 SKU
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">仓库</th>
                  <th className="p-2 font-normal">SKU</th>
                  <th className="p-2 font-normal">名称</th>
                  <th className="p-2 font-normal">可售</th>
                  <th className="p-2 font-normal">在途</th>
                  <th className="p-2 font-normal">在产(SKU)</th>
                  <th className="p-2 font-normal">预留</th>
                  <th className="p-2 font-normal">本仓有效</th>
                  <th className="p-2 font-normal">ROP</th>
                  <th className="p-2 font-normal">健康灯</th>
                  <th className="p-2 font-normal">补货灯</th>
                  <th className="p-2 font-normal">状态</th>
                  <th className="p-2 font-normal">AI</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.skuId}-${item.warehouseCode}`} className="border-b border-border/60">
                    <td className="p-2 font-mono text-text-sub">{item.warehouseCode}</td>
                    <td className="p-2 font-mono text-text-main">{item.code}</td>
                    <td className="p-2 text-text-main">{item.name}</td>
                    <td className="p-2 font-numeric text-text-main">{item.qtyAvailable}</td>
                    <td className="p-2 font-numeric text-text-main">{item.qtyInTransit}</td>
                    <td className="p-2 font-numeric text-text-sub">{item.qtyInProduction}</td>
                    <td className="p-2 font-numeric text-text-sub">{item.qtyReserved ?? 0}</td>
                    <td className="p-2 font-numeric font-medium text-primary">{item.localEffectiveQty ?? item.effectiveQty}</td>
                    <td className="p-2 font-numeric text-text-main">{item.reorderPoint ?? '-'}</td>
                    <td className="p-2">
                      <InventoryHealthBadge health={item.inventoryHealth} />
                    </td>
                    <td className="p-2">
                      <ReplenishLightBadge
                        light={item.replenishLight ?? 'red'}
                        eligible={item.replenishEligible}
                      />
                    </td>
                    <td className={`p-2 ${STATUS_COLOR[item.status] ?? 'text-text-main'}`}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </td>
                    <td className="p-2">
                      <Link
                        to={`/ai/chat?sku=${encodeURIComponent(item.code)}&skuId=${item.skuId}&warehouse=${encodeURIComponent(item.warehouseCode)}`}
                        className="text-xs text-primary hover:underline"
                      >
                        问 AI
                      </Link>
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={13} className="p-4 text-center text-text-hint">
                      暂无 SKU，请先新建
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>录入分仓库存</CardTitle>
          <p className="text-sm text-text-sub">可售与在途需指定目的仓；在途表示已发出、指向该仓的货物</p>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-6">
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={invForm.skuId}
            onChange={(e) => setInvForm({ ...invForm, skuId: e.target.value })}
          >
            <option value="">选择 SKU</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={invForm.warehouse}
            onChange={(e) => setInvForm({ ...invForm, warehouse: e.target.value })}
          >
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>{w.name} ({w.code})</option>
            ))}
          </select>
          <Input type="number" placeholder="可售" value={invForm.qtyAvailable} onChange={(e) => setInvForm({ ...invForm, qtyAvailable: +e.target.value })} />
          <Input type="number" placeholder="在途" value={invForm.qtyInTransit} onChange={(e) => setInvForm({ ...invForm, qtyInTransit: +e.target.value })} />
          <Input type="date" value={invForm.recordedDate} onChange={(e) => setInvForm({ ...invForm, recordedDate: e.target.value })} />
          <Button variant="outline" onClick={() => createInv.mutate()} disabled={!invForm.skuId || createInv.isPending}>
            保存
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>录入在产库存</CardTitle>
          <p className="text-sm text-text-sub">在产不指向仓库；货物发出后请录入对应目的仓的在途数量</p>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-4">
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={productionForm.skuId}
            onChange={(e) => setProductionForm({ ...productionForm, skuId: e.target.value })}
          >
            <option value="">选择 SKU</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            placeholder="在产数量"
            value={productionForm.qtyInProduction}
            onChange={(e) => setProductionForm({ ...productionForm, qtyInProduction: +e.target.value })}
          />
          <Input type="date" value={productionForm.recordedDate} onChange={(e) => setProductionForm({ ...productionForm, recordedDate: e.target.value })} />
          <Button variant="outline" onClick={() => createProduction.mutate()} disabled={!productionForm.skuId || createProduction.isPending}>
            保存
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
