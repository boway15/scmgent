import type { RefObject } from 'react';
import { SegmentedControl } from '@/components/SegmentedControl';

type PlatformOption = { code: string; name: string };

type Props = {
  splitChannels: boolean;
  onSplitChange: (split: boolean) => void;
  primaryPlatform: string;
  onPrimaryPlatformChange: (code: string) => void;
  selectedPlatforms: string[];
  onSelectedPlatformsChange: (codes: string[]) => void;
  channelOptions: PlatformOption[];
  channelOpen: boolean;
  onChannelOpenChange: (open: boolean) => void;
  channelMenuRef: RefObject<HTMLDivElement | null>;
  onApply: (next: { split: boolean; primaryPlatform?: string; platforms?: string[] }) => void;
};

export function HorizonChannelFilters({
  splitChannels,
  onSplitChange,
  primaryPlatform,
  onPrimaryPlatformChange,
  selectedPlatforms,
  onSelectedPlatformsChange,
  channelOptions,
  channelOpen,
  onChannelOpenChange,
  channelMenuRef,
  onApply,
}: Props) {
  const channelSummary =
    selectedPlatforms.length === 0
      ? '全部平台'
      : selectedPlatforms
          .map((code) => channelOptions.find((item) => item.code === code)?.name || code)
          .join('、');

  return (
    <>
      <div className="space-y-1 text-sm">
        <span className="block text-text-sub">平台展示</span>
        <SegmentedControl
          aria-label="平台展示"
          value={splitChannels ? 'split' : 'merged'}
          options={[
            { id: 'merged', label: '合计' },
            { id: 'split', label: '分平台' },
          ]}
          onChange={(next) => onSplitChange(next === 'split')}
        />
      </div>
      {splitChannels ? (
        <div ref={channelMenuRef} className="relative space-y-1 text-sm">
          <span className="block text-text-sub">平台</span>
          <button
            type="button"
            className="flex h-9 min-w-36 items-center rounded-md border border-border bg-card px-2 text-left text-sm"
            aria-expanded={channelOpen}
            onClick={() => onChannelOpenChange(!channelOpen)}
          >
            <span className="max-w-52 truncate">{channelSummary}</span>
          </button>
          {channelOpen ? (
            <div className="absolute z-50 mt-1 max-h-64 w-52 overflow-auto rounded-md border border-border bg-card p-2 shadow-card">
              <button
                type="button"
                className="mb-1 text-xs text-text-sub"
                onClick={() => {
                  onSelectedPlatformsChange([]);
                  onApply({ split: true, platforms: [] });
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
                        onSelectedPlatformsChange(next);
                        onApply({ split: true, platforms: next });
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
              onPrimaryPlatformChange(next);
              onChannelOpenChange(false);
              onApply({ split: false, primaryPlatform: next });
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
    </>
  );
}
