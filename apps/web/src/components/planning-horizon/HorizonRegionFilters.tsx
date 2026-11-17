import type { RefObject } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';

export const FORECAST_REGION_OPTIONS = ['US', 'CA', 'EU', 'UK', 'MX', 'BR', 'OTHER', 'UNMAPPED'] as const;

export function regionQuery(input: {
  split: boolean;
  primaryRegion: string;
  regions: string[];
}): { splitByRegion: boolean; salesRegions: string[] } {
  if (!input.split) {
    const code = input.primaryRegion.trim().toUpperCase();
    if (!code) return { splitByRegion: false, salesRegions: [] };
    return { splitByRegion: false, salesRegions: [code] };
  }
  return {
    splitByRegion: true,
    salesRegions: input.regions.map((code) => code.trim().toUpperCase()).filter(Boolean),
  };
}

type Props = {
  splitRegions: boolean;
  onSplitChange: (split: boolean) => void;
  primaryRegion: string;
  onPrimaryRegionChange: (code: string) => void;
  selectedRegions: string[];
  onSelectedRegionsChange: (codes: string[]) => void;
  regionOpen: boolean;
  onRegionOpenChange: (open: boolean) => void;
  regionMenuRef: RefObject<HTMLDivElement | null>;
  onApply: (next: { regionSplit: boolean; primaryRegion?: string; regions?: string[] }) => void;
};

export function HorizonRegionFilters({
  splitRegions,
  onSplitChange,
  primaryRegion,
  onPrimaryRegionChange,
  selectedRegions,
  onSelectedRegionsChange,
  regionOpen,
  onRegionOpenChange,
  regionMenuRef,
  onApply,
}: Props) {
  const summary = selectedRegions.length === 0 ? '全部区域' : selectedRegions.join('、');

  return (
    <>
      <div className="space-y-1 text-sm">
        <span className="block text-text-sub">区域展示</span>
        <SegmentedControl
          aria-label="区域展示"
          value={splitRegions ? 'split' : 'merged'}
          options={[
            { id: 'merged', label: '合计' },
            { id: 'split', label: '分区域' },
          ]}
          onChange={(next) => onSplitChange(next === 'split')}
        />
      </div>
      {splitRegions ? (
        <div ref={regionMenuRef} className="relative space-y-1 text-sm">
          <span className="block text-text-sub">区域</span>
          <button
            type="button"
            className="flex h-9 min-w-36 items-center rounded-md border border-border bg-card px-2 text-left text-sm"
            aria-expanded={regionOpen}
            onClick={() => onRegionOpenChange(!regionOpen)}
          >
            <span className="max-w-52 truncate">{summary}</span>
          </button>
          {regionOpen ? (
            <div className="absolute z-50 mt-1 max-h-64 w-40 overflow-auto rounded-md border border-border bg-card p-2 shadow-card">
              <button
                type="button"
                className="mb-1 text-xs text-text-sub"
                onClick={() => {
                  onSelectedRegionsChange([]);
                  onApply({ regionSplit: true, regions: [] });
                }}
              >
                全部区域
              </button>
              {FORECAST_REGION_OPTIONS.map((code) => {
                const checked = selectedRegions.includes(code);
                return (
                  <label key={code} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? selectedRegions.filter((item) => item !== code)
                          : [...selectedRegions, code];
                        onSelectedRegionsChange(next);
                        onApply({ regionSplit: true, regions: next });
                      }}
                    />
                    <span className="font-mono">{code}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <span className="block text-text-sub">区域</span>
          <select
            className="flex h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
            value={primaryRegion}
            onChange={(e) => {
              const next = e.target.value;
              onPrimaryRegionChange(next);
              onRegionOpenChange(false);
              onApply({ regionSplit: false, primaryRegion: next });
            }}
          >
            <option value="">全部</option>
            {FORECAST_REGION_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
