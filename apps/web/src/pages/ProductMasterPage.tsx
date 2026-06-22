import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import type { ReplenishLight } from '@/lib/api';

type Tab = 'spu' | 'sku' | 'merchant';

export function ProductMasterPage() {
  const [tab, setTab] = useState<Tab>('sku');
  const qc = useQueryClient();

  const { data: spus = [], isLoading: spuLoading } = useQuery({
    queryKey: ['spus'],
    queryFn: api.getSpus,
    enabled: tab === 'spu',
  });

  const { data: skuOverview = [], isLoading: skuLoading } = useQuery({
    queryKey: ['sku-overview'],
    queryFn: api.getSkuOverview,
    enabled: tab === 'sku',
  });

  const { data: merchants = [], isLoading: merchantLoading } = useQuery({
    queryKey: ['merchants-master'],
    queryFn: api.getMerchantsMaster,
    enabled: tab === 'merchant',
  });

  const [spuForm, setSpuForm] = useState({ code: '', name: '', category: '', brand: '', moq: 0 });
  const [merchantForm, setMerchantForm] = useState({ code: '', name: '', contactName: '', countryCode: '' });
  const [skuForm, setSkuForm] = useState({
    code: '',
    name: '',
    unit: 'pcs',
    spuCode: '',
    merchantCode: '',
    merchantName: '',
    replenishLight: 'red' as ReplenishLight,
  });

  const createSpu = useMutation({
    mutationFn: () => api.createSpu(spuForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['spus'] });
      setSpuForm({ code: '', name: '', category: '', brand: '', moq: 0 });
    },
  });

  const createMerchant = useMutation({
    mutationFn: () => api.createMerchant(merchantForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchants-master'] });
      qc.invalidateQueries({ queryKey: ['merchants'] });
      setMerchantForm({ code: '', name: '', contactName: '', countryCode: '' });
    },
  });

  const createSku = useMutation({
    mutationFn: () => api.createSku(skuForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sku-overview'] });
      qc.invalidateQueries({ queryKey: ['skus'] });
      setSkuForm({
        code: '',
        name: '',
        unit: 'pcs',
        spuCode: '',
        merchantCode: '',
        merchantName: '',
        replenishLight: 'red',
      });
    },
  });

  const updateSkuLight = useMutation({
    mutationFn: ({ id, replenishLight }: { id: string; replenishLight: ReplenishLight }) =>
      api.updateSku(id, { replenishLight }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sku-overview'] }),
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'spu', label: 'SPU' },
    { key: 'merchant', label: '商家' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="商品主数据" description="维护 SPU、SKU 与商家供货关系" />

      <div className="flex gap-2">
        {tabs.map((t) => (
          <Button
            key={t.key}
            size="sm"
            variant={tab === t.key ? 'default' : 'outline'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'spu' && (
        <Card>
          <CardHeader>
            <CardTitle>SPU 列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="SPU 编号" className="h-9 w-36" value={spuForm.code} onChange={(e) => setSpuForm({ ...spuForm, code: e.target.value })} />
              <Input placeholder="名称" className="h-9 w-48" value={spuForm.name} onChange={(e) => setSpuForm({ ...spuForm, name: e.target.value })} />
              <Input placeholder="品类" className="h-9 w-32" value={spuForm.category} onChange={(e) => setSpuForm({ ...spuForm, category: e.target.value })} />
              <Input placeholder="品牌" className="h-9 w-32" value={spuForm.brand} onChange={(e) => setSpuForm({ ...spuForm, brand: e.target.value })} />
              <Input
                type="number"
                placeholder="起订量 MOQ"
                className="h-9 w-28"
                value={spuForm.moq || ''}
                onChange={(e) => setSpuForm({ ...spuForm, moq: +e.target.value || 0 })}
              />
              <Button size="sm" onClick={() => createSpu.mutate()} disabled={createSpu.isPending}>
                新建 SPU
              </Button>
            </div>
            {spuLoading ? (
              <p className="text-text-sub">加载中...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">编号</th>
                    <th className="p-2 font-normal">名称</th>
                    <th className="p-2 font-normal">品类</th>
                    <th className="p-2 font-normal">品牌</th>
                    <th className="p-2 font-normal">MOQ</th>
                    <th className="p-2 font-normal">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {spus.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="p-2 font-mono">{s.code}</td>
                      <td className="p-2">{s.name}</td>
                      <td className="p-2 text-text-sub">{s.category ?? '-'}</td>
                      <td className="p-2 text-text-sub">{s.brand ?? '-'}</td>
                      <td className="p-2 text-text-sub">{s.moq ?? '-'}</td>
                      <td className="p-2">{s.isActive ? '启用' : '停用'}</td>
                    </tr>
                  ))}
                  {!spus.length && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-text-hint">
                        暂无 SPU
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'merchant' && (
        <Card>
          <CardHeader>
            <CardTitle>商家主数据</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="商家编号" className="h-9 w-36" value={merchantForm.code} onChange={(e) => setMerchantForm({ ...merchantForm, code: e.target.value })} />
              <Input placeholder="名称" className="h-9 w-48" value={merchantForm.name} onChange={(e) => setMerchantForm({ ...merchantForm, name: e.target.value })} />
              <Input placeholder="联系人" className="h-9 w-32" value={merchantForm.contactName} onChange={(e) => setMerchantForm({ ...merchantForm, contactName: e.target.value })} />
              <Input placeholder="国家码 CN" className="h-9 w-24" value={merchantForm.countryCode} onChange={(e) => setMerchantForm({ ...merchantForm, countryCode: e.target.value })} />
              <Button size="sm" onClick={() => createMerchant.mutate()} disabled={createMerchant.isPending}>
                新建商家
              </Button>
            </div>
            {merchantLoading ? (
              <p className="text-text-sub">加载中...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">编号</th>
                    <th className="p-2 font-normal">名称</th>
                    <th className="p-2 font-normal">联系人</th>
                    <th className="p-2 font-normal">国家</th>
                    <th className="p-2 font-normal">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((m) => (
                    <tr key={m.id} className="border-b border-border/60">
                      <td className="p-2 font-mono">{m.code}</td>
                      <td className="p-2">{m.name}</td>
                      <td className="p-2 text-text-sub">{m.contactName ?? '-'}</td>
                      <td className="p-2 text-text-sub">{m.countryCode ?? '-'}</td>
                      <td className="p-2">{m.isActive ? '启用' : '停用'}</td>
                    </tr>
                  ))}
                  {!merchants.length && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-text-hint">
                        暂无商家，可从 SKU 导入或手工新建
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'sku' && (
        <Card>
          <CardHeader>
            <CardTitle>SKU 概览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="SKU 编号" className="h-9 w-36" value={skuForm.code} onChange={(e) => setSkuForm({ ...skuForm, code: e.target.value })} />
              <Input placeholder="名称" className="h-9 w-40" value={skuForm.name} onChange={(e) => setSkuForm({ ...skuForm, name: e.target.value })} />
              <Input placeholder="单位 pcs" className="h-9 w-24" value={skuForm.unit} onChange={(e) => setSkuForm({ ...skuForm, unit: e.target.value })} />
              <Input placeholder="SPU 编号" className="h-9 w-32" value={skuForm.spuCode} onChange={(e) => setSkuForm({ ...skuForm, spuCode: e.target.value })} />
              <Input placeholder="商家编号" className="h-9 w-32" value={skuForm.merchantCode} onChange={(e) => setSkuForm({ ...skuForm, merchantCode: e.target.value })} />
              <Input placeholder="商家名称" className="h-9 w-32" value={skuForm.merchantName} onChange={(e) => setSkuForm({ ...skuForm, merchantName: e.target.value })} />
              <select
                className="h-9 rounded-md border border-input bg-card px-3 text-sm text-text-main"
                value={skuForm.replenishLight}
                onChange={(e) => setSkuForm({ ...skuForm, replenishLight: e.target.value as ReplenishLight })}
              >
                <option value="red">红灯（必补）</option>
                <option value="yellow">黄灯（联动）</option>
                <option value="green">绿灯（不补）</option>
              </select>
              <Button size="sm" onClick={() => createSku.mutate()} disabled={createSku.isPending}>
                新建 SKU
              </Button>
            </div>
            {skuLoading ? (
              <p className="text-text-sub">加载中...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">SKU</th>
                    <th className="p-2 font-normal">名称</th>
                    <th className="p-2 font-normal">SPU</th>
                    <th className="p-2 font-normal">亮灯</th>
                    <th className="p-2 font-normal">默认商家</th>
                    <th className="p-2 font-normal">供货方数</th>
                    <th className="p-2 font-normal">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {skuOverview.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="p-2 font-mono">{s.code}</td>
                      <td className="p-2">{s.name}</td>
                      <td className="p-2 text-text-sub">{s.spuCode ?? '-'}</td>
                      <td className="p-2">
                        <select
                          className="h-8 rounded-md border border-input bg-card px-2 text-xs text-text-main"
                          value={s.replenishLight ?? 'red'}
                          disabled={updateSkuLight.isPending}
                          onChange={(e) =>
                            updateSkuLight.mutate({
                              id: s.id,
                              replenishLight: e.target.value as ReplenishLight,
                            })
                          }
                        >
                          <option value="red">红灯</option>
                          <option value="yellow">黄灯</option>
                          <option value="green">绿灯</option>
                        </select>
                      </td>
                      <td className="p-2 text-text-sub">
                        {s.merchantCode ? `${s.merchantCode}${s.merchantName ? ` / ${s.merchantName}` : ''}` : '-'}
                      </td>
                      <td className="p-2">{s.supplierCount}</td>
                      <td className="p-2">{s.isActive ? '启用' : '停用'}</td>
                    </tr>
                  ))}
                  {!skuOverview.length && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-text-hint">
                        暂无 SKU，请新建或前往数据导入
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
