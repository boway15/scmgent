import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CostingFactory, type CostingRegion } from '@/lib/api';
import { PriceBookPanel } from '@/components/costing/PriceBookPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const FEE_NAME_OPTIONS = ['人工', '管理', '能耗', '水电', '厂房', '利润', '税点'];

const DEFAULT_PACK = {
  cornerAllowanceMm: '80',
  foamThicknessMm: '20',
  foamYuanPerM3: '280',
  cartonYuanPerM2: '4.9',
  cornerYuanEach: '0.5',
} as const;

type CostingConfigPanelProps = {
  readOnly: boolean;
};

export function CostingConfigPanel({ readOnly }: CostingConfigPanelProps) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [newRegionName, setNewRegionName] = useState('');
  const [newFactoryName, setNewFactoryName] = useState('');
  const [newFactoryRegionId, setNewFactoryRegionId] = useState('');
  const [feeRegionId, setFeeRegionId] = useState('');
  const [feeFactoryId, setFeeFactoryId] = useState('');
  const [feeName, setFeeName] = useState('税点');
  const [feePercent, setFeePercent] = useState('');
  const [packFactoryId, setPackFactoryId] = useState('');
  const [packDraft, setPackDraft] = useState({ ...DEFAULT_PACK });

  const regionsQuery = useQuery({
    queryKey: ['costing-regions'],
    queryFn: () => api.listCostingRegions(),
  });
  const factoriesQuery = useQuery({
    queryKey: ['costing-factories'],
    queryFn: () => api.listCostingFactories(),
  });
  const feeRatesQuery = useQuery({
    queryKey: ['costing-fee-rates', feeRegionId, feeFactoryId],
    queryFn: () =>
      api.listCostingFeeRates({
        regionId: feeRegionId || undefined,
        factoryId: feeFactoryId || undefined,
      }),
  });

  const regions = regionsQuery.data?.items ?? [];
  const factories = factoriesQuery.data?.items ?? [];
  const feeRates = feeRatesQuery.data?.items ?? [];

  useEffect(() => {
    const factory = factories.find((item) => item.id === packFactoryId);
    if (!factory) {
      setPackDraft({ ...DEFAULT_PACK });
      return;
    }
    const profile = factory.packProfile ?? {};
    setPackDraft({
      cornerAllowanceMm: String(profile.cornerAllowanceMm ?? DEFAULT_PACK.cornerAllowanceMm),
      foamThicknessMm: String(profile.foamThicknessMm ?? DEFAULT_PACK.foamThicknessMm),
      foamYuanPerM3: String(profile.foamYuanPerM3 ?? DEFAULT_PACK.foamYuanPerM3),
      cartonYuanPerM2: String(profile.cartonYuanPerM2 ?? DEFAULT_PACK.cartonYuanPerM2),
      cornerYuanEach: String(profile.cornerYuanEach ?? DEFAULT_PACK.cornerYuanEach),
    });
  }, [packFactoryId, factories]);

  const savePackProfile = useMutation({
    mutationFn: () =>
      api.patchCostingFactoryPackProfile(packFactoryId, {
        cornerAllowanceMm: Number(packDraft.cornerAllowanceMm),
        foamThicknessMm: Number(packDraft.foamThicknessMm),
        foamYuanPerM3: Number(packDraft.foamYuanPerM3),
        cartonYuanPerM2: Number(packDraft.cartonYuanPerM2),
        cornerYuanEach: Number(packDraft.cornerYuanEach),
      }),
    onSuccess: () => {
      setMessage('');
      return refreshCatalogs();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const refreshCatalogs = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['costing-regions'] }),
      queryClient.invalidateQueries({ queryKey: ['costing-factories'] }),
      queryClient.invalidateQueries({ queryKey: ['costing-catalogs'] }),
      queryClient.invalidateQueries({ queryKey: ['costing-fee-rates'] }),
    ]);

  const createRegion = useMutation({
    mutationFn: () => api.createCostingRegion({ name: newRegionName.trim() }),
    onSuccess: () => {
      setNewRegionName('');
      setMessage('');
      return refreshCatalogs();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const createFactory = useMutation({
    mutationFn: () =>
      api.createCostingFactory({
        name: newFactoryName.trim(),
        regionId: newFactoryRegionId || null,
      }),
    onSuccess: () => {
      setNewFactoryName('');
      setMessage('');
      return refreshCatalogs();
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const upsertFee = useMutation({
    mutationFn: () =>
      api.upsertCostingFeeRate({
        name: feeName.trim(),
        regionId: feeRegionId,
        factoryId: feeFactoryId,
        rate: Number(feePercent) / 100,
      }),
    onSuccess: () => {
      setFeePercent('');
      setMessage('');
      return queryClient.invalidateQueries({ queryKey: ['costing-fee-rates'] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const disableFee = useMutation({
    mutationFn: api.disableCostingFeeRate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['costing-fee-rates'] }),
    onError: (error: Error) => setMessage(error.message),
  });

  const regionName = (id: string) => regions.find((item) => item.id === id)?.name ?? id;
  const factoryName = (id: string) => factories.find((item) => item.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      {message && (
        <p className="text-sm text-destructive" role="status">
          {message}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <DictCard
          title="区域"
          hint="通用区域用于全局价；常州/漳州等用于区域通用价"
          items={regions}
          readOnly={readOnly}
          draft={newRegionName}
          onDraftChange={setNewRegionName}
          pending={createRegion.isPending}
          onCreate={() => createRegion.mutate()}
        />
        <Card>
          <CardHeader>
            <CardTitle>工厂</CardTitle>
            <p className="text-sm text-text-hint">通用工厂用于区域通用与全局价；具名工厂用于工厂专用价</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {!readOnly && (
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  className="min-w-36 flex-1"
                  placeholder="工厂名称"
                  value={newFactoryName}
                  onChange={(event) => setNewFactoryName(event.target.value)}
                />
                <select
                  className="h-10 min-w-32 rounded-md border border-input bg-card px-3 text-sm"
                  value={newFactoryRegionId}
                  onChange={(event) => setNewFactoryRegionId(event.target.value)}
                >
                  <option value="">不绑定区域</option>
                  {regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={!newFactoryName.trim() || createFactory.isPending}
                  onClick={() => createFactory.mutate()}
                >
                  {createFactory.isPending ? '添加中...' : '添加'}
                </Button>
              </div>
            )}
            <ul className="space-y-1 text-sm">
              {factories.map((factory: CostingFactory) => (
                <li key={factory.id} className="flex justify-between gap-3">
                  <span>
                    {factory.name}
                    <span className="ml-2 font-mono text-text-hint">{factory.code}</span>
                  </span>
                  <span className="text-text-sub">
                    {factory.regionId ? regionName(factory.regionId) : '不绑定'}
                    {!factory.isActive ? ' · 停用' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>费用系数</CardTitle>
          <p className="text-sm text-text-hint">
            按区域×工厂维护占比，计提基数为材料+加工。约书亚类「人工已含在材料价」把该厂人工配成 0。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-text-sub">
              区域
              <select
                className="mt-1 block h-10 min-w-32 rounded-md border border-input bg-card px-3 text-sm"
                value={feeRegionId}
                onChange={(event) => setFeeRegionId(event.target.value)}
              >
                <option value="">全部</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-text-sub">
              工厂
              <select
                className="mt-1 block h-10 min-w-32 rounded-md border border-input bg-card px-3 text-sm"
                value={feeFactoryId}
                onChange={(event) => setFeeFactoryId(event.target.value)}
              >
                <option value="">全部</option>
                {factories.map((factory) => (
                  <option key={factory.id} value={factory.id}>
                    {factory.name}
                  </option>
                ))}
              </select>
            </label>
            {!readOnly && (
              <>
                <label className="text-sm text-text-sub">
                  费用项
                  <input
                    list="costing-fee-names"
                    className="mt-1 block h-10 min-w-28 rounded-md border border-input bg-card px-3 text-sm"
                    value={feeName}
                    onChange={(event) => setFeeName(event.target.value)}
                  />
                  <datalist id="costing-fee-names">
                    {FEE_NAME_OPTIONS.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </label>
                <label className="w-28 text-sm text-text-sub">
                  费率（%）
                  <Input
                    className="mt-1 font-mono"
                    type="number"
                    min={0}
                    step="0.01"
                    value={feePercent}
                    onChange={(event) => setFeePercent(event.target.value)}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={
                    !feeName.trim() ||
                    !feeRegionId ||
                    !feeFactoryId ||
                    feePercent === '' ||
                    Number(feePercent) < 0 ||
                    upsertFee.isPending
                  }
                  onClick={() => upsertFee.mutate()}
                >
                  {upsertFee.isPending ? '保存中...' : '保存费率'}
                </Button>
              </>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  {['费用项', '区域', '工厂', '费率', '状态', '操作'].map((label) => (
                    <th key={label} className="p-2 font-normal">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feeRates.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-border/60 ${item.isActive ? '' : 'text-text-hint'}`}
                  >
                    <td className="p-2">{item.name}</td>
                    <td className="p-2">{regionName(item.regionId)}</td>
                    <td className="p-2">{factoryName(item.factoryId)}</td>
                    <td className="p-2 font-mono">{(Number(item.rate) * 100).toFixed(2)}%</td>
                    <td className="p-2">{item.isActive ? '启用' : '停用'}</td>
                    <td className="p-2">
                      {item.isActive && !readOnly && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disableFee.isPending}
                          onClick={() => disableFee.mutate(item.id)}
                        >
                          停用
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!feeRates.length && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-text-hint">
                      暂无费用系数。选择区域和工厂后保存，例如通用×通用的税点。
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
          <CardTitle>工厂包装档案</CardTitle>
          <p className="text-sm text-text-hint">
            覆盖包装公式五个参数。未配置时使用默认：护角余量 80mm、保利龙 20mm·280 元/m³、纸箱 4.9 元/m²、护角 0.5 元/个。
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm text-text-sub">
            工厂
            <select
              className="mt-1 block h-10 min-w-48 rounded-md border border-input bg-card px-3 text-sm"
              value={packFactoryId}
              onChange={(event) => setPackFactoryId(event.target.value)}
            >
              <option value="">选择工厂</option>
              {factories
                .filter((factory) => factory.code !== 'generic')
                .map((factory) => (
                  <option key={factory.id} value={factory.id}>
                    {factory.name}
                  </option>
                ))}
            </select>
          </label>
          {packFactoryId ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ['cornerAllowanceMm', '护角余量（mm）'],
                  ['foamThicknessMm', '保利龙厚度（mm）'],
                  ['foamYuanPerM3', '保利龙单价（元/m³）'],
                  ['cartonYuanPerM2', '纸箱单价（元/m²）'],
                  ['cornerYuanEach', '护角单价（元/个）'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-sm text-text-sub">
                  {label}
                  <Input
                    className="mt-1 font-mono"
                    type="number"
                    min="0"
                    step="0.01"
                    value={packDraft[key]}
                    disabled={readOnly}
                    onChange={(event) => setPackDraft({ ...packDraft, [key]: event.target.value })}
                  />
                </label>
              ))}
            </div>
          ) : null}
          {!readOnly && packFactoryId ? (
            <Button
              variant="outline"
              disabled={savePackProfile.isPending}
              onClick={() => savePackProfile.mutate()}
            >
              {savePackProfile.isPending ? '保存中…' : '保存包装档案'}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <PriceBookPanel readOnly={readOnly} />
    </div>
  );
}

function DictCard({
  title,
  hint,
  items,
  readOnly,
  draft,
  onDraftChange,
  pending,
  onCreate,
}: {
  title: string;
  hint: string;
  items: CostingRegion[];
  readOnly: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  pending: boolean;
  onCreate: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-text-hint">{hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!readOnly && (
          <div className="flex gap-2">
            <Input
              placeholder={`${title}名称`}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <Button variant="outline" disabled={!draft.trim() || pending} onClick={onCreate}>
              {pending ? '添加中...' : '添加'}
            </Button>
          </div>
        )}
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <span>
                {item.name}
                <span className="ml-2 font-mono text-text-hint">{item.code}</span>
              </span>
              <span className="text-text-sub">{item.isActive ? '' : '停用'}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
