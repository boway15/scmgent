import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { DemandPlanHorizonPanel } from '@/components/DemandPlanHorizonPanel';
import type { DemandPlanSkuClickInput } from '@/components/DemandPlanSkuDetailDrawer';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { HorizonChannelFilters } from '@/components/planning-horizon/HorizonChannelFilters';
import { HorizonSkuTierFilters } from '@/components/planning-horizon/HorizonSkuTierFilters';
import {
  channelQuery,
  type HorizonChannelView,
} from '@/components/planning-horizon/useHorizonChannelQuery';
import { api } from '@/lib/api';
import { useProductScope } from '@/lib/product-scope';

type Props = {
  active: boolean;
  fixedVersionId: string;
  fixedVersionLabel?: string;
  grain: 'week' | 'month';
  editable?: boolean;
  pageSize?: number;
  title?: string;
  description?: string;
  headerExtra?: React.ReactNode;
  calibrationImportEnabled?: boolean;
  showPendingCalibrationShortcut?: boolean;
  initialCalibrationImportOpen?: boolean;
  onSkuClick?: (input: DemandPlanSkuClickInput) => void;
};

export function DemandPlanDataExplorer({
  active,
  fixedVersionId,
  fixedVersionLabel,
  grain,
  editable = false,
  pageSize = 20,
  title = '计划数据',
  description = '合计时一个 SKU 一行（悬停可看分平台拆分）；切换「分平台」后各渠道各占一行。SKU 可一次填多个（逗号或空格）。列表按商品分层（T1→T99）再按 SKU 排序。宽表为周度矩阵；草稿可长表改数，或分平台导出校准表后批量导入（导入反算全平台合计）。',
  headerExtra,
  calibrationImportEnabled = false,
  showPendingCalibrationShortcut = false,
  initialCalibrationImportOpen = false,
  onSkuClick,
}: Props) {
  const { productScope } = useProductScope();
  const { data: platformOptions } = useQuery({
    queryKey: ['sales-platforms', 'all'],
    queryFn: () => api.getSalesPlatforms(),
    enabled: active && grain === 'week',
  });

  const [skuCode, setSkuCode] = useState('');
  const [splitChannels, setSplitChannels] = useState(false);
  const [primaryPlatform, setPrimaryPlatform] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [channelOpen, setChannelOpen] = useState(false);
  const channelMenuRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [profileSegment, setProfileSegment] = useState('');
  const [pendingCalibration, setPendingCalibration] = useState(false);
  const [applied, setApplied] = useState({
    skuCode: '',
    versionId: fixedVersionId,
    channelView: 'merged' as HorizonChannelView,
    platforms: [] as string[],
    categories: [] as string[],
    profileSegment: '',
    pendingCalibration: false,
  });

  useEffect(() => {
    setApplied((current) => ({ ...current, versionId: fixedVersionId }));
  }, [fixedVersionId]);

  useEffect(() => {
    if (!channelOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!channelMenuRef.current?.contains(event.target as Node)) setChannelOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [channelOpen]);

  const applyFilters = (next?: {
    split?: boolean;
    primaryPlatform?: string;
    platforms?: string[];
    pendingCalibration?: boolean;
    profileSegment?: string;
  }) => {
    const query = channelQuery({
      split: next?.split ?? splitChannels,
      primaryPlatform: next?.primaryPlatform ?? primaryPlatform,
      platforms: next?.platforms ?? selectedPlatforms,
    });
    setApplied({
      skuCode: skuCode.trim(),
      versionId: fixedVersionId,
      ...query,
      categories,
      profileSegment: (next?.profileSegment ?? profileSegment).trim(),
      pendingCalibration: next?.pendingCalibration ?? pendingCalibration,
    });
  };

  const togglePendingCalibration = () => {
    const next = !pendingCalibration;
    setPendingCalibration(next);
    if (next) setProfileSegment('');
    applyFilters({ pendingCalibration: next, profileSegment: next ? '' : profileSegment });
  };

  const setGrain = (nextSplit: boolean) => {
    if (nextSplit) {
      const seeded =
        selectedPlatforms.length === 0 && primaryPlatform ? [primaryPlatform] : selectedPlatforms;
      setSplitChannels(true);
      setSelectedPlatforms(seeded);
      setChannelOpen(false);
      applyFilters({ split: true, platforms: seeded });
      return;
    }
    const nextPrimary = selectedPlatforms.length === 1 ? selectedPlatforms[0]! : '';
    setSplitChannels(false);
    setPrimaryPlatform(nextPrimary);
    setChannelOpen(false);
    applyFilters({ split: false, primaryPlatform: nextPrimary });
  };

  const channelOptions = (platformOptions ?? []).filter((item) => item.code !== 'ALL');

  if (!active) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-sm text-text-sub">{description}</p>
          {fixedVersionLabel ? (
            <p className="mt-1 font-mono text-xs text-text-sub">版本：{fixedVersionLabel}</p>
          ) : null}
        </div>
        {headerExtra}
      </CardHeader>
      <CardContent className="space-y-4">
        {grain === 'week' ? <ProductScopeSwitch /> : null}
        <div className="relative z-30 flex flex-wrap items-end gap-x-3 gap-y-3 overflow-visible rounded-md border border-border/80 bg-muted/20 p-3">
          {grain === 'week' ? (
            <HorizonChannelFilters
              splitChannels={splitChannels}
              onSplitChange={setGrain}
              primaryPlatform={primaryPlatform}
              onPrimaryPlatformChange={setPrimaryPlatform}
              selectedPlatforms={selectedPlatforms}
              onSelectedPlatformsChange={setSelectedPlatforms}
              channelOptions={channelOptions}
              channelOpen={channelOpen}
              onChannelOpenChange={setChannelOpen}
              channelMenuRef={channelMenuRef}
              onApply={(next) => applyFilters(next)}
            />
          ) : null}
          <div className="flex flex-col gap-1 text-sm">
            <span className="block text-text-sub">SKU</span>
            <Input
              placeholder={grain === 'week' ? '多个用逗号或空格分隔' : 'SKU'}
              className={grain === 'week' ? 'h-9 w-56 font-mono' : 'h-9 w-36 font-mono'}
              value={skuCode}
              onChange={(event) => setSkuCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters();
              }}
            />
          </div>
          {grain === 'week' ? (
            <>
              <div className="w-56 shrink-0 space-y-1 text-sm">
                <span className="block text-text-sub">品类（可多选）</span>
                <CategorySearchSelect
                  multiple
                  scope="forecast"
                  value={categories}
                  onChange={setCategories}
                  placeholder="搜索品类…"
                />
              </div>
              <HorizonSkuTierFilters
                profileSegment={pendingCalibration ? 'T99' : profileSegment}
                onProfileSegmentChange={setProfileSegment}
                pendingCalibration={pendingCalibration}
                onTogglePendingCalibration={togglePendingCalibration}
                showPendingCalibrationShortcut={showPendingCalibrationShortcut}
                onApply={(next) => {
                  if (next?.pendingCalibration === false) setPendingCalibration(false);
                  applyFilters({
                    profileSegment: next?.profileSegment,
                    pendingCalibration: next?.pendingCalibration,
                  });
                }}
              />
            </>
          ) : null}
          <Button className="shrink-0" variant="outline" onClick={() => applyFilters()}>
            查询
          </Button>
        </div>

        {!fixedVersionId ? (
          <p className="text-sm text-text-sub">未指定需求计划版本。</p>
        ) : (
          <DemandPlanHorizonPanel
            key={JSON.stringify({ ...applied, productScope })}
            active={Boolean(fixedVersionId)}
            versionId={fixedVersionId}
            skuCode={applied.skuCode || undefined}
            grain={grain}
            editable={editable}
            pageSize={pageSize}
            channelView={applied.channelView}
            platforms={applied.platforms}
            profileSegment={applied.profileSegment || undefined}
            pendingCalibration={applied.pendingCalibration}
            categories={applied.categories}
            productScope={productScope}
            calibrationImportEnabled={calibrationImportEnabled && grain === 'week'}
            initialCalibrationImportOpen={initialCalibrationImportOpen}
            onSkuClick={onSkuClick}
          />
        )}
      </CardContent>
    </Card>
  );
}
