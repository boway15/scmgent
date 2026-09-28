import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemandPlanHorizonPanel } from '@/components/DemandPlanHorizonPanel';
import type { DemandPlanSkuClickInput } from '@/components/DemandPlanSkuDetailDrawer';

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
  description = '列表按 SKU 编码排序。宽表为周度矩阵（生效日均），长表为 SKU × 周期明细。草稿人工调整请在长表保存。',
  headerExtra,
  onSkuClick,
}: Props) {
  const [skuCode, setSkuCode] = useState('');
  const [applied, setApplied] = useState({ skuCode: '', versionId: fixedVersionId });

  useEffect(() => {
    setApplied((current) => ({ ...current, versionId: fixedVersionId }));
  }, [fixedVersionId]);

  const applyFilters = () => {
    setApplied({ skuCode: skuCode.trim(), versionId: fixedVersionId });
  };

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
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-sm">
            <span className="text-text-sub">SKU</span>
            <Input
              placeholder="SKU"
              className="h-9 w-36 font-mono"
              value={skuCode}
              onChange={(event) => setSkuCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyFilters();
              }}
            />
          </label>
          <Button variant="outline" onClick={applyFilters}>
            查询
          </Button>
        </div>

        {!fixedVersionId ? (
          <p className="text-sm text-text-sub">未指定需求计划版本。</p>
        ) : (
          <DemandPlanHorizonPanel
            key={JSON.stringify(applied)}
            active={Boolean(fixedVersionId)}
            versionId={fixedVersionId}
            skuCode={applied.skuCode || undefined}
            grain={grain}
            editable={editable}
            pageSize={pageSize}
            onSkuClick={onSkuClick}
          />
        )}
      </CardContent>
    </Card>
  );
}
