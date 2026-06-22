import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AiBannerProps = {
  message: string;
  onFix?: () => void;
  fixLabel?: string;
};

export function AiBanner({ message, onFix, fixLabel = '一键修复' }: AiBannerProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        <span className="text-sm text-text-main">{message}</span>
      </div>
      {onFix && (
        <Button variant="ai-fix" size="sm" onClick={onFix}>
          {fixLabel}
        </Button>
      )}
    </div>
  );
}
