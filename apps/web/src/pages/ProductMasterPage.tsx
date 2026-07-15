import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ProductMasterSkuTable } from '@/components/ProductMasterSkuTable';
import { ImportDrawer } from '@/components/import/ImportDrawer';
import { useImportDrawer } from '@/hooks/use-import-drawer';
import { useResizableColumnWidths } from '@/hooks/use-resizable-column-widths';
import {
  defaultProductMasterSkuColumnWidth,
  loadProductMasterSkuColumnWidths,
  PRODUCT_MASTER_SKU_COLUMN_WIDTHS_KEY,
  saveProductMasterSkuColumnWidths,
} from '@/lib/product-master-sku-columns';
import type { ReplenishLight, SkuOverview } from '@/lib/api';

type Tab = 'spu' | 'sku' | 'merchant';

const DEFAULT_PAGE_SIZE = 20;

const PRODUCT_MASTER_SKU_RESIZE = {
  storageKey: PRODUCT_MASTER_SKU_COLUMN_WIDTHS_KEY,
  loadWidths: loadProductMasterSkuColumnWidths,
  saveWidths: saveProductMasterSkuColumnWidths,
  defaultColumnWidth: defaultProductMasterSkuColumnWidth,
} as const;

type SkuEditForm = {
  name: string;
  unit: string;
  category: string;
  leadTimeDays: string;
  moq: string;
  unitCost: string;
  merchantCode: string;
  merchantName: string;
  replenishLight: ReplenishLight;
};

type SkuFilters = {
  q: string;
  category: string;
  lifecycle: string;
  salesCountry: string;
  merchantCode: string;
  ownerName: string;
  developerName: string;
};

type SpuFilters = {
  q: string;
  category: string;
  brand: string;
};

const EMPTY_SKU_FILTERS: SkuFilters = {
  q: '',
  category: '',
  lifecycle: '',
  salesCountry: '',
  merchantCode: '',
  ownerName: '',
  developerName: '',
};

const EMPTY_SPU_FILTERS: SpuFilters = {
  q: '',
  category: '',
  brand: '',
};

function toSkuFilterParams(filters: SkuFilters) {
  return {
    q: filters.q || undefined,
    category: filters.category || undefined,
    lifecycle: filters.lifecycle || undefined,
    salesCountry: filters.salesCountry || undefined,
    merchantCode: filters.merchantCode || undefined,
    ownerName: filters.ownerName || undefined,
    developerName: filters.developerName || undefined,
  };
}

function toSpuFilterParams(filters: SpuFilters) {
  return {
    q: filters.q || undefined,
    category: filters.category || undefined,
    brand: filters.brand || undefined,
  };
}

export function ProductMasterPage() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab === 'merchant' || initialTab === 'spu' ? initialTab : 'sku',
  );
  const { open: importOpen, openDrawer: openImportDrawer, closeDrawer: closeImportDrawer } = useImportDrawer();
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [skuPage, setSkuPage] = useState(1);
  const [spuPage, setSpuPage] = useState(1);
  const [merchantPage, setMerchantPage] = useState(1);
  const qc = useQueryClient();

  const [skuFilters, setSkuFilters] = useState<SkuFilters>(EMPTY_SKU_FILTERS);
  const [skuApplied, setSkuApplied] = useState<SkuFilters>(EMPTY_SKU_FILTERS);
  const [spuFilters, setSpuFilters] = useState<SpuFilters>(EMPTY_SPU_FILTERS);
  const [spuApplied, setSpuApplied] = useState<SpuFilters>(EMPTY_SPU_FILTERS);
  const [merchantQ, setMerchantQ] = useState('');
  const [merchantAppliedQ, setMerchantAppliedQ] = useState('');
  const { getWidth: getSkuColumnWidth, onResizeStart: onSkuColumnResizeStart } =
    useResizableColumnWidths(PRODUCT_MASTER_SKU_RESIZE);

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setSkuPage(1);
    setSpuPage(1);
    setMerchantPage(1);
  };

  const { data: spuData, isLoading: spuLoading } = useQuery({
    queryKey: ['spus', spuPage, pageSize, spuApplied],
    queryFn: () => api.getSpus({ ...toSpuFilterParams(spuApplied), page: spuPage, pageSize }),
    enabled: tab === 'spu',
  });

  const { data: skuData, isLoading: skuLoading } = useQuery({
    queryKey: ['sku-overview', skuPage, pageSize, skuApplied],
    queryFn: () => api.getSkuOverview({ ...toSkuFilterParams(skuApplied), page: skuPage, pageSize }),
    enabled: tab === 'sku',
  });

  const { data: merchantData, isLoading: merchantLoading } = useQuery({
    queryKey: ['merchants-master', merchantPage, pageSize, merchantAppliedQ],
    queryFn: () =>
      api.getMerchantsMaster({
        q: merchantAppliedQ || undefined,
        page: merchantPage,
        pageSize,
      }),
    enabled: tab === 'merchant',
  });

  const spus = spuData?.items ?? [];
  const skuOverview = skuData?.items ?? [];
  const merchants = merchantData?.items ?? [];

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

  const [editingSku, setEditingSku] = useState<SkuOverview | null>(null);
  const [skuEditForm, setSkuEditForm] = useState<SkuEditForm>({
    name: '',
    unit: 'pcs',
    category: '',
    leadTimeDays: '',
    moq: '',
    unitCost: '',
    merchantCode: '',
    merchantName: '',
    replenishLight: 'red',
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

  const updateSku = useMutation({
    mutationFn: () => {
      if (!editingSku) throw new Error('未选择 SKU');
      return api.updateSku(editingSku.id, {
        name: skuEditForm.name.trim(),
        unit: skuEditForm.unit.trim(),
        category: skuEditForm.category.trim() || undefined,
        leadTimeDays: skuEditForm.leadTimeDays ? Number(skuEditForm.leadTimeDays) : undefined,
        moq: skuEditForm.moq ? Number(skuEditForm.moq) : undefined,
        unitCost: skuEditForm.unitCost ? Number(skuEditForm.unitCost) : undefined,
        merchantCode: skuEditForm.merchantCode.trim() || undefined,
        merchantName: skuEditForm.merchantName.trim() || undefined,
        replenishLight: skuEditForm.replenishLight,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sku-overview'] });
      qc.invalidateQueries({ queryKey: ['skus'] });
      setEditingSku(null);
    },
  });

  const startEditSku = (sku: SkuOverview) => {
    setEditingSku(sku);
    setSkuEditForm({
      name: sku.name,
      unit: sku.unit,
      category: sku.category ?? '',
      leadTimeDays: sku.leadTimeDays != null ? String(sku.leadTimeDays) : '',
      moq: sku.moq != null ? String(sku.moq) : '',
      unitCost: sku.unitCost ?? '',
      merchantCode: sku.merchantCode ?? '',
      merchantName: sku.merchantName ?? '',
      replenishLight: sku.replenishLight ?? 'red',
    });
  };

  const applySkuFilters = () => {
    setSkuPage(1);
    setSkuApplied({ ...skuFilters });
  };

  const applySpuFilters = () => {
    setSpuPage(1);
    setSpuApplied({ ...spuFilters });
  };

  const applyMerchantFilters = () => {
    setMerchantPage(1);
    setMerchantAppliedQ(merchantQ);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'spu', label: 'SPU' },
    { key: 'merchant', label: '商家' },
  ];

  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab === 'merchant' || urlTab === 'spu' || urlTab === 'sku') {
      setTab(urlTab);
    }
  }, [searchParams]);

  const importType = tab === 'merchant' ? 'merchants' : 'skus';

  const handleImportSuccess = () => {
    if (tab === 'merchant') {
      void qc.invalidateQueries({ queryKey: ['merchants-master'] });
      void qc.invalidateQueries({ queryKey: ['merchants'] });
    } else {
      void qc.invalidateQueries({ queryKey: ['sku-overview'] });
      void qc.invalidateQueries({ queryKey: ['skus'] });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="商品主数据">
        {(tab === 'sku' || tab === 'merchant') && (
          <Button variant="outline" onClick={openImportDrawer}>
            {tab === 'merchant' ? '批量导入' : '导入 SKU'}
          </Button>
        )}
      </PageHeader>

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
            <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-4">
              <Input
                placeholder="SPU / 名称"
                value={spuFilters.q}
                onChange={(e) => setSpuFilters({ ...spuFilters, q: e.target.value })}
              />
              <Input
                placeholder="品类"
                value={spuFilters.category}
                onChange={(e) => setSpuFilters({ ...spuFilters, category: e.target.value })}
              />
              <Input
                placeholder="品牌"
                value={spuFilters.brand}
                onChange={(e) => setSpuFilters({ ...spuFilters, brand: e.target.value })}
              />
              <Button variant="outline" onClick={applySpuFilters}>
                查询
              </Button>
            </div>
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
            {spuData && (
              <ListPagination
                page={spuPage}
                pageSize={pageSize}
                total={spuData.total}
                onPageChange={setSpuPage}
                onPageSizeChange={handlePageSizeChange}
              />
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
            <div className="flex flex-wrap gap-2 rounded-md border border-border bg-muted/20 p-4">
              <Input
                placeholder="商家编号 / 名称"
                className="h-9 w-64"
                value={merchantQ}
                onChange={(e) => setMerchantQ(e.target.value)}
              />
              <Button variant="outline" size="sm" onClick={applyMerchantFilters}>
                查询
              </Button>
            </div>
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
            {merchantData && (
              <ListPagination
                page={merchantPage}
                pageSize={pageSize}
                total={merchantData.total}
                onPageChange={setMerchantPage}
                onPageSizeChange={handlePageSizeChange}
              />
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
            <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-4 lg:grid-cols-8">
              <Input
                placeholder="SKU / 名称"
                value={skuFilters.q}
                onChange={(e) => setSkuFilters({ ...skuFilters, q: e.target.value })}
              />
              <Input
                placeholder="品类"
                value={skuFilters.category}
                onChange={(e) => setSkuFilters({ ...skuFilters, category: e.target.value })}
              />
              <Input
                placeholder="生命周期"
                value={skuFilters.lifecycle}
                onChange={(e) => setSkuFilters({ ...skuFilters, lifecycle: e.target.value })}
              />
              <Input
                placeholder="销售国家"
                value={skuFilters.salesCountry}
                onChange={(e) => setSkuFilters({ ...skuFilters, salesCountry: e.target.value })}
              />
              <Input
                placeholder="供应商编码"
                value={skuFilters.merchantCode}
                onChange={(e) => setSkuFilters({ ...skuFilters, merchantCode: e.target.value })}
              />
              <Input
                placeholder="负责人"
                value={skuFilters.ownerName}
                onChange={(e) => setSkuFilters({ ...skuFilters, ownerName: e.target.value })}
              />
              <Input
                placeholder="开发人员"
                value={skuFilters.developerName}
                onChange={(e) => setSkuFilters({ ...skuFilters, developerName: e.target.value })}
              />
              <Button variant="outline" onClick={applySkuFilters}>
                查询
              </Button>
            </div>
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
            {editingSku && (
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-medium text-text-main">
                  编辑 SKU：<span className="font-mono">{editingSku.code}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="名称"
                    className="h-9 w-48"
                    value={skuEditForm.name}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, name: e.target.value })}
                  />
                  <Input
                    placeholder="单位"
                    className="h-9 w-20"
                    value={skuEditForm.unit}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, unit: e.target.value })}
                  />
                  <Input
                    placeholder="品类"
                    className="h-9 w-40"
                    value={skuEditForm.category}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, category: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="交期(天)"
                    className="h-9 w-28"
                    value={skuEditForm.leadTimeDays}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, leadTimeDays: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="MOQ"
                    className="h-9 w-24"
                    value={skuEditForm.moq}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, moq: e.target.value })}
                  />
                  <Input
                    type="number"
                    placeholder="成本单价"
                    className="h-9 w-28"
                    value={skuEditForm.unitCost}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, unitCost: e.target.value })}
                  />
                  <Input
                    placeholder="商家编号"
                    className="h-9 w-32"
                    value={skuEditForm.merchantCode}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, merchantCode: e.target.value })}
                  />
                  <Input
                    placeholder="商家名称"
                    className="h-9 w-32"
                    value={skuEditForm.merchantName}
                    onChange={(e) => setSkuEditForm({ ...skuEditForm, merchantName: e.target.value })}
                  />
                  <select
                    className="h-9 rounded-md border border-input bg-card px-3 text-sm text-text-main"
                    value={skuEditForm.replenishLight}
                    onChange={(e) =>
                      setSkuEditForm({ ...skuEditForm, replenishLight: e.target.value as ReplenishLight })
                    }
                  >
                    <option value="red">红灯</option>
                    <option value="yellow">黄灯</option>
                    <option value="green">绿灯</option>
                  </select>
                  <Button size="sm" onClick={() => updateSku.mutate()} disabled={updateSku.isPending}>
                    保存
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingSku(null)}>
                    取消
                  </Button>
                </div>
              </div>
            )}
            {skuLoading ? (
              <p className="text-text-sub">加载中...</p>
            ) : (
              <ProductMasterSkuTable
                items={skuOverview}
                getColumnWidth={getSkuColumnWidth}
                onResizeStart={onSkuColumnResizeStart}
                onEditSku={startEditSku}
                onUpdateReplenishLight={(id, replenishLight) =>
                  updateSkuLight.mutate({ id, replenishLight })
                }
                updateLightPending={updateSkuLight.isPending}
              />
            )}
            {skuData && (
              <ListPagination
                page={skuPage}
                pageSize={pageSize}
                total={skuData.total}
                onPageChange={setSkuPage}
                onPageSizeChange={handlePageSizeChange}
              />
            )}
          </CardContent>
        </Card>
      )}

      <ImportDrawer
        open={importOpen}
        type={importType}
        onClose={closeImportDrawer}
        onSuccess={handleImportSuccess}
      />
    </div>
  );
}
