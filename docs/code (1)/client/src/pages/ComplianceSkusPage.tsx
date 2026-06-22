import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type ComplianceSkuRow } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ComplianceStatusBadge } from '@/components/ComplianceStatusBadge';

const EMPTY_FORM = {
  hsCode: '',
  originCountry: '',
  declaredValue: '',
  weightKg: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  batteryType: '',
  isLiquid: false,
};

export function ComplianceSkusPage() {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState(searchParams.get('sku') ?? '');
  const [editing, setEditing] = useState<ComplianceSkuRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    const sku = searchParams.get('sku');
    if (sku) setQ(sku);
  }, [searchParams]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['compliance-skus', category, status, q],
    queryFn: () =>
      api.getComplianceSkus({
        category: category || undefined,
        status: status || undefined,
        q: q || undefined,
      }),
  });

  const { data: overview } = useQuery({
    queryKey: ['compliance-overview-categories'],
    queryFn: () => api.getComplianceOverview(),
  });

  const save = useMutation({
    mutationFn: () =>
      api.putSkuCompliance(editing!.skuId, {
        hsCode: form.hsCode || undefined,
        originCountry: form.originCountry || undefined,
        declaredValue: form.declaredValue ? Number(form.declaredValue) : undefined,
        weightKg: form.weightKg ? Number(form.weightKg) : undefined,
        lengthCm: form.lengthCm ? Number(form.lengthCm) : undefined,
        widthCm: form.widthCm ? Number(form.widthCm) : undefined,
        heightCm: form.heightCm ? Number(form.heightCm) : undefined,
        batteryType: form.batteryType || undefined,
        isLiquid: form.isLiquid,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['compliance-skus'] });
      qc.invalidateQueries({ queryKey: ['compliance-overview'] });
      qc.invalidateQueries({ queryKey: ['sku-overview'] });
      setEditing(null);
      setForm(EMPTY_FORM);
    },
  });

  const openEdit = (row: ComplianceSkuRow) => {
    setEditing(row);
    setForm({
      hsCode: row.hsCode ?? '',
      originCountry: row.originCountry ?? '',
      declaredValue: row.declaredValue ?? '',
      weightKg: row.weightKg ?? '',
      lengthCm: row.lengthCm ?? '',
      widthCm: row.widthCm ?? '',
      heightCm: row.heightCm ?? '',
      batteryType: row.batteryType ?? '',
      isLiquid: row.isLiquid ?? false,
    });
  };

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="SKU 合规维护">
        <Link to="/compliance/overview" className={buttonVariants({ variant: 'outline' })}>
          合规总览
        </Link>
        <Link to="/data/import?type=compliance" className={buttonVariants({ variant: 'outline' })}>
          批量导入
        </Link>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>SKU 列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="搜索 SKU 编号或名称"
              className="h-9 w-48"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">全部品类</option>
              {(overview?.categories ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-card px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="complete">完整</option>
              <option value="partial">部分缺失</option>
              <option value="missing">未维护</option>
            </select>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">名称</th>
                <th className="p-2 font-normal">HS</th>
                <th className="p-2 font-normal">原产国</th>
                <th className="p-2 font-normal">重量 kg</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.skuId} className="border-b border-border/60">
                  <td className="p-2 font-mono">{row.skuCode}</td>
                  <td className="p-2">{row.skuName}</td>
                  <td className="p-2 font-mono">{row.hsCode ?? '-'}</td>
                  <td className="p-2">{row.originCountry ?? '-'}</td>
                  <td className="p-2 font-numeric">{row.weightKg ?? '-'}</td>
                  <td className="p-2">
                    <ComplianceStatusBadge status={row.complianceStatus} />
                  </td>
                  <td className="p-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-text-hint">
                    无匹配 SKU
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <CardTitle>
              编辑合规 — {editing.skuCode} {editing.skuName}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="HS 编码"
              value={form.hsCode}
              onChange={(e) => setForm({ ...form, hsCode: e.target.value })}
            />
            <Input
              placeholder="原产国 CN"
              value={form.originCountry}
              onChange={(e) => setForm({ ...form, originCountry: e.target.value })}
            />
            <Input
              placeholder="申报价值"
              type="number"
              value={form.declaredValue}
              onChange={(e) => setForm({ ...form, declaredValue: e.target.value })}
            />
            <Input
              placeholder="重量 kg"
              type="number"
              value={form.weightKg}
              onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
            />
            <Input
              placeholder="长 cm"
              type="number"
              value={form.lengthCm}
              onChange={(e) => setForm({ ...form, lengthCm: e.target.value })}
            />
            <Input
              placeholder="宽 cm"
              type="number"
              value={form.widthCm}
              onChange={(e) => setForm({ ...form, widthCm: e.target.value })}
            />
            <Input
              placeholder="高 cm"
              type="number"
              value={form.heightCm}
              onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
            />
            <Input
              placeholder="电池类型（空=无）"
              value={form.batteryType}
              onChange={(e) => setForm({ ...form, batteryType: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isLiquid}
                onChange={(e) => setForm({ ...form, isLiquid: e.target.checked })}
              />
              液体商品
            </label>
            <div className="flex gap-2 md:col-span-3">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? '保存中...' : '保存'}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
