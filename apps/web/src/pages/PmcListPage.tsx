import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ImportDrawer } from '@/components/import/ImportDrawer';
import { useImportDrawer } from '@/hooks/use-import-drawer';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

export function PmcListPage() {
  const qc = useQueryClient();
  const { open: importOpen, openDrawer: openImportDrawer, closeDrawer: closeImportDrawer } = useImportDrawer();
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['pmc-plans'],
    queryFn: api.getPmcPlans,
  });
  const { data: skus = [] } = useQuery({ queryKey: ['skus'], queryFn: api.getSkus });
  const { data: merchants = [] } = useQuery({ queryKey: ['merchants'], queryFn: api.getMerchants });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: api.getWarehouses });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    merchantCode: '',
    merchantName: '',
    targetWarehouseCode: 'US-WEST',
    planDate: new Date().toISOString().slice(0, 10),
    deliveryDate: '',
    skuId: '',
    plannedQty: 0,
  });

  const createPlan = useMutation({
    mutationFn: () =>
      api.createPmcPlan({
        name: form.name,
        merchantCode: form.merchantCode,
        merchantName: form.merchantName || undefined,
        targetWarehouseCode: form.targetWarehouseCode,
        planDate: form.planDate,
        deliveryDate: form.deliveryDate || form.planDate,
        items: [{ skuId: form.skuId, plannedQty: form.plannedQty, warehouseCode: form.targetWarehouseCode }],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pmc-plans'] });
      setShowForm(false);
    },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.updatePmcPlanStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pmc-plans'] });
      qc.invalidateQueries({ queryKey: ['purchase-tracking'] });
    },
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="下单计划">
        <div className="flex gap-2">
          <Button variant="outline" onClick={openImportDrawer}>
            批量导入
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>{showForm ? '取消' : '新建计划'}</Button>
        </div>
      </PageHeader>

      {showForm && (
        <Card>
          <CardContent className="grid gap-2 pt-6 md:grid-cols-8">
            <Input placeholder="计划名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input
              placeholder="商家编号"
              list="merchant-codes"
              value={form.merchantCode}
              onChange={(e) => {
                const code = e.target.value;
                const m = merchants.find((x) => x.merchantCode === code);
                setForm({ ...form, merchantCode: code, merchantName: m?.merchantName ?? form.merchantName });
              }}
            />
            <datalist id="merchant-codes">
              {merchants.map((m) => (
                <option key={m.merchantCode} value={m.merchantCode} />
              ))}
            </datalist>
            <Input placeholder="商家名称" value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} />
            <select
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={form.targetWarehouseCode}
              onChange={(e) => setForm({ ...form, targetWarehouseCode: e.target.value })}
            >
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>{w.name}</option>
              ))}
            </select>
            <Input type="date" value={form.planDate} onChange={(e) => setForm({ ...form, planDate: e.target.value })} />
            <Input type="date" placeholder="交期" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} />
            <select
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={form.skuId}
              onChange={(e) => setForm({ ...form, skuId: e.target.value })}
            >
              <option value="">选择 SKU</option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>{s.code}</option>
              ))}
            </select>
            <Input type="number" placeholder="计划数量" value={form.plannedQty} onChange={(e) => setForm({ ...form, plannedQty: +e.target.value })} />
            <Button
              variant="outline"
              onClick={() => createPlan.mutate()}
              disabled={!form.name || !form.merchantCode || !form.skuId || createPlan.isPending}
            >
              保存
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>计划列表</CardTitle>
          <p className="text-sm text-text-sub">
            一个计划对应一个商家；导出 CSV 后人工发给商家，确认后生成采购跟单
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">编号</th>
                <th className="p-2 font-normal">名称</th>
                <th className="p-2 font-normal">商家</th>
                <th className="p-2 font-normal">目标仓</th>
                <th className="p-2 font-normal">计划日期</th>
                <th className="p-2 font-normal">交期</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="p-2 font-mono text-text-main">
                    <Link to={`/pmc/${p.id}`} className="text-primary hover:underline">{p.planNo}</Link>
                  </td>
                  <td className="p-2">{p.name}</td>
                  <td className="p-2 font-mono">{p.merchantName ?? p.merchantCode}</td>
                  <td className="p-2 font-mono">{p.targetWarehouseCode ?? '-'}</td>
                  <td className="p-2">{String(p.planDate).slice(0, 10)}</td>
                  <td className="p-2">{String(p.deliveryDate).slice(0, 10)}</td>
                  <td className="p-2">{STATUS_LABEL[p.status] ?? p.status}</td>
                  <td className="space-x-1 p-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => api.exportPmcPlanCsv(p.id, p.planNo)}
                    >
                      导出
                    </Button>
                    {p.status === 'draft' && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: p.id, status: 'confirmed' })}>
                        确认计划
                      </Button>
                    )}
                    {p.status === 'confirmed' && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: p.id, status: 'in_progress' })}>
                        开始执行
                      </Button>
                    )}
                    {p.status === 'in_progress' && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: p.id, status: 'completed' })}>
                        完成
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!plans.length && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-text-hint">暂无计划</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <ImportDrawer
        open={importOpen}
        type="pmc_plans"
        onClose={closeImportDrawer}
        onSuccess={() => void qc.invalidateQueries({ queryKey: ['pmc-plans'] })}
      />
    </div>
  );
}
