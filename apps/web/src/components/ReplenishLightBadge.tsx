import { cn } from '@/lib/utils';
import type { ReplenishLight } from '@/lib/api';

const LIGHT_META: Record<
  ReplenishLight,
  { label: string; dot: string; title: string }
> = {
  red: {
    label: '红灯',
    dot: 'bg-red-500',
    title: '必须补货：低于 ROP 时生成补货建议',
  },
  yellow: {
    label: '黄灯',
    dot: 'bg-amber-400',
    title: '联动补货：仅当同 SPU 有红灯 SKU 需补时才补',
  },
  green: {
    label: '绿灯',
    dot: 'bg-emerald-500',
    title: '不补货：不参与自动补货建议',
  },
};

export function ReplenishLightBadge({
  light,
  eligible,
  className,
}: {
  light: ReplenishLight;
  eligible?: boolean;
  className?: string;
}) {
  const meta = LIGHT_META[light];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', className)}
      title={
        eligible == null
          ? meta.title
          : `${meta.title}${eligible ? ' · 当前可补' : ' · 当前不补'}`
      }
    >
      <span className={cn('inline-block h-2.5 w-2.5 rounded-full', meta.dot)} aria-hidden />
      <span className="text-text-main">{meta.label}</span>
      {eligible != null && (
        <span className={eligible ? 'text-primary' : 'text-text-hint'}>
          {eligible ? '可补' : '不补'}
        </span>
      )}
    </span>
  );
}
