import { cn } from '@/lib/utils';

export type InventoryHealth = 'red' | 'yellow' | 'green' | 'blue' | 'gray';

const LIGHT_META: Record<
  InventoryHealth,
  { label: string; dot: string; title: string }
> = {
  blue: {
    label: '蓝灯',
    dot: 'bg-blue-500',
    title: '库存超多：覆盖天数超过超备阈值',
  },
  green: {
    label: '绿灯',
    dot: 'bg-emerald-500',
    title: '库存健康：覆盖天数处于安全区间',
  },
  yellow: {
    label: '黄灯',
    dot: 'bg-amber-400',
    title: '库存有风险：进入补货计划窗口',
  },
  red: {
    label: '红灯',
    dot: 'bg-red-500',
    title: '库存很浅：覆盖低于总提前期，必须补货',
  },
  gray: {
    label: '灰灯',
    dot: 'bg-gray-400',
    title: '滞销或即将停售：暂停自动补货建议',
  },
};

const LEGACY_MAP: Record<string, InventoryHealth> = {
  healthy: 'green',
  overstock: 'blue',
};

export function normalizeInventoryHealth(
  raw: string | null | undefined,
): InventoryHealth | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key in LIGHT_META) return key as InventoryHealth;
  return LEGACY_MAP[key] ?? null;
}

export function InventoryHealthBadge({
  health,
  className,
}: {
  health: InventoryHealth | string | null | undefined;
  className?: string;
}) {
  const normalized = normalizeInventoryHealth(health ?? undefined);
  if (!normalized) return <span className="text-text-hint">-</span>;
  const meta = LIGHT_META[normalized];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', className)}
      title={meta.title}
    >
      <span className={cn('inline-block h-2.5 w-2.5 rounded-full', meta.dot)} aria-hidden />
      <span className="text-text-main">{meta.label}</span>
    </span>
  );
}
