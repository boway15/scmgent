import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { ForecastHorizonPanel } from '@/components/ForecastHorizonPanel';
import { FORECAST_ALLCAT_V41_TIER_OPTIONS } from '@/lib/forecast-labels';
import type { ForecastHorizonRow } from '@/components/ForecastSkuDetailDrawer';

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
  onSkuClick?: (row: ForecastHorizonRow, versionId: string, ctx: { platform: string }) => void;
  headerExtra?: React.ReactNode;
  title?: string;
  description?: string;
  topSection?: React.ReactNode;
  showPendingCalibrationShortcut?: boolean;
};

export function ForecastDataExplorer({
  active,
  platforms,
  pageSize = 20,
  fixedVersionId,
  fixedVersionLabel,
  initialPlatform = '',
  onSkuClick,
  headerExtra,
  title = '预测数据',
  description = '未来矩阵为预测日均，历史矩阵为销量折算实际日均，明细可同时查看历史与未来。点击 SKU 查看因子与逐月详情。',
  topSection,
  showPendingCalibrationShortcut = false,
}: Props) {
  const [skuCode, setSkuCode] = useState('');
  const [platform, setPlatform] = useState(initialPlatform);
  const [category, setCategory] = useState('');
  const [profileSegment, setProfileSegment] = useState('');
  const [pendingCalibration, setPendingCalibration] = useState(false);
  const [applied, setApplied] = useState({
    skuCode: '',
    platform: initialPlatform,
    category: '',
    profileSegment: '',
    pendingCalibration: false,
    versionId: fixedVersionId,
  });

  useEffect(() => {
    setApplied((current) => ({ ...current, versionId: fixedVersionId }));
  }, [fixedVersionId]);

  useEffect(() => {
    const nextPlatform = initialPlatform.trim();
    setPlatform(nextPlatform);
    setApplied((current) => ({
      ...current,
      platform: nextPlatform,
      versionId: fixedVersionId,
    }));
  }, [initialPlatform, fixedVersionId]);

  const applyFilters = () => {
    setApplied({
      skuCode,
      platform,
      category,
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
      platform,
      category,
      profileSegment,
      pendingCalibration: next,
      versionId: fixedVersionId,
    });
  };

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
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="text-text-sub">SKU</span>
            <Input
              placeholder="SKU"
              className="h-9 w-36"
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-text-sub">渠道</span>
            <select
              className="flex h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
              value={platform}
              onChange={(e) => {
                const next = e.target.value;
                setPlatform(next);
                setApplied((current) => ({
                  ...current,
                  platform: next,
                  versionId: fixedVersionId,
                }));
              }}
            >
              <option value="">全渠道汇总</option>
              {(platforms ?? []).filter((p) => p.code !== 'ALL').map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name || p.code}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-text-sub">品类</span>
            <CategorySearchSelect
              scope="forecast"
              value={category}
              onChange={setCategory}
              className="w-full max-w-md"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-text-sub">分层</span>
            <select
              className="h-9 rounded-md border border-border bg-card px-3 text-sm"
              value={profileSegment}
              onChange={(e) => {
                const next = e.target.value;
                setProfileSegment(next);
                setPendingCalibration(false);
                setApplied({
                  skuCode,
                  platform,
                  category,
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
          </label>
          <Button variant="outline" onClick={applyFilters}>
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
