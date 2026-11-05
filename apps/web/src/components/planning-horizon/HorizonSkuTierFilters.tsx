import { Button } from '@/components/ui/button';
import { FORECAST_ALLCAT_V41_TIER_OPTIONS } from '@/lib/forecast-labels';

type Props = {
  profileSegment: string;
  onProfileSegmentChange: (value: string) => void;
  pendingCalibration: boolean;
  onTogglePendingCalibration: () => void;
  showPendingCalibrationShortcut?: boolean;
  onApply: (next?: { profileSegment?: string; pendingCalibration?: boolean }) => void;
};

export function HorizonSkuTierFilters({
  profileSegment,
  onProfileSegmentChange,
  pendingCalibration,
  onTogglePendingCalibration,
  showPendingCalibrationShortcut = false,
  onApply,
}: Props) {
  return (
    <>
      <div className="flex flex-col gap-1 text-sm">
        <span className="block text-text-sub">商品分层</span>
        <select
          className="flex h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
          value={profileSegment}
          disabled={pendingCalibration}
          onChange={(e) => {
            const next = e.target.value;
            onProfileSegmentChange(next);
            onApply({ profileSegment: next, pendingCalibration: false });
          }}
        >
          {FORECAST_ALLCAT_V41_TIER_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      {showPendingCalibrationShortcut ? (
        <Button
          size="sm"
          variant={pendingCalibration ? 'default' : 'outline'}
          className="h-9"
          onClick={onTogglePendingCalibration}
        >
          待校准（T99）
        </Button>
      ) : null}
    </>
  );
}
