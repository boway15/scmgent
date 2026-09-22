import { useEffect, useMemo } from 'react';
import { CheckCircle2, Circle, LoaderCircle } from 'lucide-react';
import { AiProgressBar } from '@/components/AiProgressBar';
import { Card, CardContent } from '@/components/ui/card';
import { useStagedProgress, type StagedProgressStep } from '@/hooks/useStagedProgress';
import { cn } from '@/lib/utils';

export type ApplyFactsProgressContext = {
  bomLineCount: number;
  category: string | null;
  drawerCount: number | null;
  carcassThicknessMm: number | null;
  sideThicknessMm: number | null;
  backThicknessMm: number | null;
};

function buildApplyFactsSteps(ctx: ApplyFactsProgressContext): StagedProgressStep[] {
  const carcass = ctx.carcassThicknessMm ?? ctx.sideThicknessMm ?? '—';
  const back = ctx.backThicknessMm ?? '—';
  const drawers = ctx.drawerCount ?? '—';
  const category = ctx.category?.trim() || '产品';

  return [
    {
      id: 'save',
      label: '保存板厚与五金参数',
      detail: `柜体 ${carcass}mm · 背板 ${back}mm`,
      minMs: 500,
      weight: 8,
    },
    {
      id: 'reset',
      label: '清除上次开料与包装行',
      detail: '保留手工添加行，重置规则开料结果',
      minMs: 700,
      weight: 12,
    },
    {
      id: 'baseline',
      label: '回退至物料识别基线',
      detail: `共 ${ctx.bomLineCount} 行待处理`,
      minMs: 900,
      weight: 14,
    },
    {
      id: 'carcass',
      label: '按板厚展开箱体结构件',
      detail: `${category} · 侧板 / 顶底板 / 背板`,
      minMs: 1400,
      weight: 24,
    },
    {
      id: 'drawer',
      label: '推算抽盒与拉条开料',
      detail: `${drawers} 抽 · 抽面 / 抽侧 / 抽底 / 拉条`,
      minMs: 1200,
      weight: 20,
    },
    {
      id: 'pack',
      label: '补充五金、包装与螺丝包',
      detail: '按工厂包装档案推算纸箱与珍珠棉',
      minMs: 800,
      weight: 12,
    },
    {
      id: 'persist',
      label: '写入清单并刷新价目匹配',
      detail: '同步 BOM 与价目库',
      minMs: 600,
      weight: 10,
    },
  ];
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes} 分 ${rest} 秒`;
}

type ApplyFactsProgressCardProps = {
  active: boolean;
  finished: boolean;
  context: ApplyFactsProgressContext;
};

export function ApplyFactsProgressCard({ active, finished, context }: ApplyFactsProgressCardProps) {
  const steps = useMemo(
    () => buildApplyFactsSteps(context),
    [
      context.bomLineCount,
      context.category,
      context.drawerCount,
      context.carcassThicknessMm,
      context.sideThicknessMm,
      context.backThicknessMm,
    ],
  );
  const progressActive = active || finished;
  const { stepIndex, done, percent, elapsedMs, currentStep, complete } = useStagedProgress(steps, progressActive);

  useEffect(() => {
    if (finished) complete();
  }, [finished, complete]);

  if (!progressActive && !done) return null;

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-main">
              {done ? '开料清单已生成' : '正在生成开料清单'}
            </p>
            <p className="text-xs text-text-sub">
              {done
                ? `用时 ${formatElapsed(elapsedMs)}，请核对板材行后再计算成本`
                : `${currentStep?.label ?? '处理中'}… · 已用时 ${formatElapsed(elapsedMs)}`}
            </p>
          </div>
          <p className="font-mono text-sm tabular-nums text-primary">{Math.round(percent)}%</p>
        </div>

        <AiProgressBar active percent={percent} />

        <ol className="space-y-2">
          {steps.map((step, index) => {
            const status =
              done || index < stepIndex ? 'done' : index === stepIndex ? 'active' : 'pending';
            return (
              <li
                key={step.id}
                className={cn(
                  'flex items-start gap-2 text-sm transition-opacity',
                  status === 'pending' && 'opacity-45',
                  status === 'active' && 'opacity-100',
                  status === 'done' && 'opacity-80',
                )}
              >
                {status === 'done' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                ) : status === 'active' ? (
                  <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-hint" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className={cn('text-text-main', status === 'active' && 'font-medium')}>{step.label}</p>
                  {step.detail ? <p className="text-xs text-text-sub">{step.detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
