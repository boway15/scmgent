import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { ForecastHorizonPanel } from '@/components/ForecastHorizonPanel';
import type { ForecastHorizonRow } from '@/components/ForecastSkuDetailDrawer';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { HorizonChannelFilters } from '@/components/planning-horizon/HorizonChannelFilters';
import { HorizonRegionFilters, regionQuery } from '@/components/planning-horizon/HorizonRegionFilters';
import { HorizonSkuTierFilters } from '@/components/planning-horizon/HorizonSkuTierFilters';
import {
  channelQuery,
  initialChannelSelection,
} from '@/components/planning-horizon/useHorizonChannelQuery';
import {
  DataQuerySubmitButton,
  DataQueryToolbar,
} from '@/components/data-query';

type VersionOption = {
  id: string;
  versionNo: string;
  versionName: string;
  status: string;
};

type Props = {
  active: boolean;
  versionOptions?: VersionOption[];
  platforms?: Array<{ code: string; name: string }>;
  pageSize?: number;
  fixedVersionId: string;
  fixedVersionLabel?: string;
  initialPlatform?: string;
  onSkuClick?: (
    row: ForecastHorizonRow,
    versionId: string,
    ctx: { platform: string; splitByRegion: boolean; salesRegions: string[] },
  ) => void;
  headerExtra?: React.ReactNode;
  title?: string;
  description?: string;
  topSection?: React.ReactNode;
  showPendingCalibrationShortcut?: boolean;
  calibrationImportEnabled?: boolean;
  calibrationExportEnabled?: boolean;
  initialCalibrationImportOpen?: boolean;
};

export function ForecastDataExplorer({
  active,
  platforms: platformOptions,
  pageSize = 20,
  fixedVersionId,
  fixedVersionLabel,
  initialPlatform = '',
  onSkuClick,
  headerExtra,
  title = '预测数据',
  description = '平台和区域各自可合计或拆开。合计且选「全部」是该维度加总；选一个只看该值。切换「分平台 / 分区域」后每个取值各占一行。SKU 可一次填多个，用逗号或空格分隔。列表按商品分层（T1→T99）再按 SKU 编码排序。导出与当前查询一致。',
  topSection,
  showPendingCalibrationShortcut = false,
  calibrationImportEnabled = false,
  calibrationExportEnabled = false,
  initialCalibrationImportOpen = false,
}: Props) {
  const initialChannel = initialChannelSelection(initialPlatform);
  const [skuCode, setSkuCode] = useState('');
  const [splitChannels, setSplitChannels] = useState(initialChannel.split);
  const [primaryPlatform, setPrimaryPlatform] = useState(initialChannel.primaryPlatform);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initialChannel.platforms);
  const [channelOpen, setChannelOpen] = useState(false);
  const channelMenuRef = useRef<HTMLDivElement>(null);
  const [splitRegions, setSplitRegions] = useState(false);
  const [primaryRegion, setPrimaryRegion] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [regionOpen, setRegionOpen] = useState(false);
  const regionMenuRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [profileSegment, setProfileSegment] = useState('');
  const [pendingCalibration, setPendingCalibration] = useState(false);
  const [applied, setApplied] = useState({
    skuCode: '',
    ...channelQuery(initialChannel),
    ...regionQuery({ split: false, primaryRegion: '', regions: [] }),
    categories: [] as string[],
    profileSegment: '',
    pendingCalibration: false,
    versionId: fixedVersionId,
  });

  useEffect(() => {
    if (!channelOpen && !regionOpen) return;
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (channelOpen && !channelMenuRef.current?.contains(target)) setChannelOpen(false);
      if (regionOpen && !regionMenuRef.current?.contains(target)) setRegionOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [channelOpen, regionOpen]);

  useEffect(() => {
    const next = initialChannelSelection(initialPlatform);
    setSplitChannels(next.split);
    setPrimaryPlatform(next.primaryPlatform);
    setSelectedPlatforms(next.platforms);
    setApplied((current) => ({
      ...current,
      ...channelQuery(next),
      versionId: fixedVersionId,
    }));
  }, [initialPlatform, fixedVersionId]);

  const applyFilters = (next?: {
    split?: boolean;
    primaryPlatform?: string;
    platforms?: string[];
    regionSplit?: boolean;
    primaryRegion?: string;
    regions?: string[];
    pendingCalibration?: boolean;
    profileSegment?: string;
  }) => {
    const query = channelQuery({
      split: next?.split ?? splitChannels,
      primaryPlatform: next?.primaryPlatform ?? primaryPlatform,
      platforms: next?.platforms ?? selectedPlatforms,
    });
    const region = regionQuery({
      split: next?.regionSplit ?? splitRegions,
      primaryRegion: next?.primaryRegion ?? primaryRegion,
      regions: next?.regions ?? selectedRegions,
    });
    setApplied({
      skuCode: skuCode.trim(),
      ...query,
      ...region,
      categories,
      profileSegment: (next?.profileSegment ?? profileSegment).trim(),
      pendingCalibration: next?.pendingCalibration ?? pendingCalibration,
      versionId: fixedVersionId,
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

  const setRegionGrain = (nextSplit: boolean) => {
    if (nextSplit) {
      const seeded =
        selectedRegions.length === 0 && primaryRegion ? [primaryRegion] : selectedRegions;
      setSplitRegions(true);
      setSelectedRegions(seeded);
      setRegionOpen(false);
      applyFilters({ regionSplit: true, regions: seeded });
      return;
    }
    const nextPrimary = selectedRegions.length === 1 ? selectedRegions[0]! : '';
    setSplitRegions(false);
    setPrimaryRegion(nextPrimary);
    setRegionOpen(false);
    applyFilters({ regionSplit: false, primaryRegion: nextPrimary });
  };

  const channelOptions = (platformOptions ?? []).filter((item) => item.code !== 'ALL');

  if (!active) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-sm text-text-sub">{description}</p>
          {fixedVersionLabel && (
            <p className="mt-1 font-mono text-xs text-text-sub">版本：{fixedVersionLabel}</p>
          )}
        </div>
        {headerExtra}
      </CardHeader>
      <CardContent className="space-y-4">
        {topSection}
        <ProductScopeSwitch />
        <DataQueryToolbar>
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
          <HorizonRegionFilters
            splitRegions={splitRegions}
            onSplitChange={setRegionGrain}
            primaryRegion={primaryRegion}
            onPrimaryRegionChange={setPrimaryRegion}
            selectedRegions={selectedRegions}
            onSelectedRegionsChange={setSelectedRegions}
            regionOpen={regionOpen}
            onRegionOpenChange={setRegionOpen}
            regionMenuRef={regionMenuRef}
            onApply={(next) => applyFilters(next)}
          />
          <div className="flex flex-col gap-1 text-sm">
            <span className="block text-text-sub">SKU</span>
            <Input
              placeholder="多个用逗号或空格分隔"
              className="h-9 w-56"
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </div>
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
          <DataQuerySubmitButton onClick={() => applyFilters()} />
        </DataQueryToolbar>

        {!fixedVersionId ? (
          <p className="text-sm text-text-sub">未指定预测版本。</p>
        ) : (
          <ForecastHorizonPanel
            key={JSON.stringify(applied)}
            active={Boolean(fixedVersionId)}
            filters={applied}
            pageSize={pageSize}
            onSkuClick={
              onSkuClick
                ? (row, ctx) =>
                    onSkuClick(row, fixedVersionId, ctx)
                : undefined
            }
            calibrationImportEnabled={calibrationImportEnabled}
            calibrationExportEnabled={calibrationExportEnabled}
            initialCalibrationImportOpen={initialCalibrationImportOpen}
          />
        )}
      </CardContent>
    </Card>
  );
}
