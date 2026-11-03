import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { ForecastHorizonPanel } from '@/components/ForecastHorizonPanel';
import { FORECAST_ALLCAT_V41_TIER_OPTIONS } from '@/lib/forecast-labels';
import type { ForecastHorizonRow } from '@/components/ForecastSkuDetailDrawer';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { SegmentedControl } from '@/components/SegmentedControl';

type VersionOption = {
  id: string;
  versionNo: string;
  versionName: string;
  status: string;
};

type ChannelView = 'merged' | 'by_channel';

type Props = {
  active: boolean;
  versionOptions?: VersionOption[];
  platforms?: Array<{ code: string; name: string }>;
  pageSize?: number;
  fixedVersionId: string;
  fixedVersionLabel?: string;
  initialPlatform?: string;
  onSkuClick?: (row: ForecastHorizonRow, versionId: string, ctx: { platform: string }) => void;
  headerExtra?: React.ReactNode;
  title?: string;
  description?: string;
  topSection?: React.ReactNode;
  showPendingCalibrationShortcut?: boolean;
};

function initialChannelSelection(initialPlatform: string): {
  split: boolean;
  primaryPlatform: string;
  platforms: string[];
} {
  const code = initialPlatform.trim();
  if (!code || code.toUpperCase() === 'ALL') {
    return { split: false, primaryPlatform: '', platforms: [] };
  }
  return { split: false, primaryPlatform: code, platforms: [code] };
}

function channelQuery(input: {
  split: boolean;
  primaryPlatform: string;
  platforms: string[];
}): { channelView: ChannelView; platforms: string[] } {
  if (!input.split) {
    const code = input.primaryPlatform.trim();
    if (!code) return { channelView: 'merged', platforms: [] };
    return { channelView: 'by_channel', platforms: [code] };
  }
  return { channelView: 'by_channel', platforms: input.platforms };
}

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
  description = '合计时一个 SKU 一行；选「全部」是各平台加总，选一个平台只看该平台。切换「分平台」后每个平台各占一行。SKU 可一次填多个，用逗号或空格分隔。列表按商品分层（T1→T99）再按 SKU 编码排序。导出与当前查询一致。',
  topSection,
  showPendingCalibrationShortcut = false,
}: Props) {
  const initialChannel = initialChannelSelection(initialPlatform);
  const [skuCode, setSkuCode] = useState('');
  const [splitChannels, setSplitChannels] = useState(initialChannel.split);
  const [primaryPlatform, setPrimaryPlatform] = useState(initialChannel.primaryPlatform);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initialChannel.platforms);
  const [channelOpen, setChannelOpen] = useState(false);
  const channelMenuRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [profileSegment, setProfileSegment] = useState('');
  const [pendingCalibration, setPendingCalibration] = useState(false);
  const [applied, setApplied] = useState({
    skuCode: '',
    ...channelQuery(initialChannel),
    categories: [] as string[],
    profileSegment: '',
    pendingCalibration: false,
    versionId: fixedVersionId,
  });

  useEffect(() => {
    if (!channelOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!channelMenuRef.current?.contains(event.target as Node)) setChannelOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [channelOpen]);

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
  }) => {
    const query = channelQuery({
      split: next?.split ?? splitChannels,
      primaryPlatform: next?.primaryPlatform ?? primaryPlatform,
      platforms: next?.platforms ?? selectedPlatforms,
    });
    setApplied({
      skuCode,
      ...query,
      categories,
      profileSegment,
      pendingCalibration,
      versionId: fixedVersionId,
    });
  };

  const togglePendingCalibration = () => {
    const next = !pendingCalibration;
    setPendingCalibration(next);
    setApplied({
      skuCode,
      ...channelQuery({ split: splitChannels, primaryPlatform, platforms: selectedPlatforms }),
      categories,
      profileSegment,
      pendingCalibration: next,
      versionId: fixedVersionId,
    });
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
  const channelSummary =
    selectedPlatforms.length === 0
      ? '全部平台'
      : selectedPlatforms
          .map((code) => channelOptions.find((item) => item.code === code)?.name || code)
          .join('、');

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
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 text-sm">
            <span className="block text-text-sub">平台展示</span>
            <SegmentedControl
              aria-label="平台展示"
              value={splitChannels ? 'split' : 'merged'}
              options={[
                { id: 'merged', label: '合计' },
                { id: 'split', label: '分平台' },
              ]}
              onChange={(next) => setGrain(next === 'split')}
            />
          </div>
          {splitChannels ? (
            <div ref={channelMenuRef} className="relative space-y-1 text-sm">
              <span className="block text-text-sub">平台</span>
              <button
                type="button"
                className="flex h-9 min-w-36 items-center rounded-md border border-border bg-card px-2 text-left text-sm"
                aria-expanded={channelOpen}
                onClick={() => setChannelOpen((open) => !open)}
              >
                <span className="max-w-52 truncate">{channelSummary}</span>
              </button>
              {channelOpen ? (
                <div className="absolute z-20 mt-1 max-h-64 w-52 overflow-auto rounded-md border border-border bg-card p-2 shadow-card">
                  <button
                    type="button"
                    className="mb-1 text-xs text-text-sub"
                    onClick={() => {
                      setSelectedPlatforms([]);
                      applyFilters({ split: true, platforms: [] });
                    }}
                  >
                    全部平台
                  </button>
                  {channelOptions.map((item) => {
                    const checked = selectedPlatforms.includes(item.code);
                    return (
                      <label key={item.code} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selectedPlatforms.filter((code) => code !== item.code)
                              : [...selectedPlatforms, item.code];
                            setSelectedPlatforms(next);
                            applyFilters({ split: true, platforms: next });
                          }}
                        />
                        <span>{item.name || item.code}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <span className="block text-text-sub">平台</span>
              <select
                className="flex h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
                value={primaryPlatform}
                onChange={(e) => {
                  const next = e.target.value;
                  setPrimaryPlatform(next);
                  setChannelOpen(false);
                  applyFilters({ split: false, primaryPlatform: next });
                }}
              >
                <option value="">全部</option>
                {channelOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name || item.code}
                  </option>
                ))}
              </select>
            </div>
          )}
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
          <div className="flex flex-col gap-1 text-sm">
            <span className="block text-text-sub">分层</span>
            <select
              className="flex h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
              value={profileSegment}
              onChange={(e) => {
                const next = e.target.value;
                setProfileSegment(next);
                setPendingCalibration(false);
                setApplied({
                  skuCode,
                  ...channelQuery({
                    split: splitChannels,
                    primaryPlatform,
                    platforms: selectedPlatforms,
                  }),
                  categories,
                  profileSegment: next,
                  pendingCalibration: false,
                  versionId: fixedVersionId,
                });
              }}
            >
              {FORECAST_ALLCAT_V41_TIER_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={() => applyFilters()}>
            查询
          </Button>
          {showPendingCalibrationShortcut && (
            <Button
              variant={pendingCalibration ? 'default' : 'outline'}
              onClick={togglePendingCalibration}
            >
              待校准（T99）
            </Button>
          )}
        </div>

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
                    onSkuClick(row, fixedVersionId, {
                      platform: ctx.platform,
                    })
                : undefined
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
