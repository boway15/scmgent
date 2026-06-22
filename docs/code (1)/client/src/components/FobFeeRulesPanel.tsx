import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type BillFilter = 'all' | 'trucking' | 'freight';
type FobFeeRule = Awaited<ReturnType<typeof api.getFobFeeRules>>[number];

/** 全局规则仅支持三种分摊口径；固定费用在批次异常审核中单次指定 */
const METHOD_OPTIONS = [
  { value: 'by_volume', label: '按体积' },
  { value: 'by_ticket', label: '按票' },
  { value: 'manual', label: '需确认（平账时指定）' },
] as const;

type RuleAllocationMethod = (typeof METHOD_OPTIONS)[number]['value'];

function ruleMethodSelectValue(method: string): RuleAllocationMethod {
  if (method === 'by_volume' || method === 'by_ticket' || method === 'manual') return method;
  return 'manual';
}

const STAGE_OPTIONS = [
  { value: 'trucking', label: '拖车' },
  { value: 'freight', label: '货运' },
  { value: 'customs', label: '清关' },
  { value: 'other', label: '其他' },
] as const;

const emptyForm = {
  feeType: '',
  matchPattern: '',
  sourceBillType: 'trucking' as 'trucking' | 'freight',
  allocationMethod: 'by_volume' as (typeof METHOD_OPTIONS)[number]['value'],
  defaultStage: 'other' as (typeof STAGE_OPTIONS)[number]['value'],
  priority: '10',
  remark: '',
};

export function FobFeeRulesPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<BillFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['fob-fee-rules', filter],
    queryFn: () =>
      api.getFobFeeRules(filter === 'all' ? undefined : { sourceBillType: filter }),
  });

  const createRule = useMutation({
    mutationFn: () =>
      api.createFobFeeRule({
        feeType: form.feeType.trim() || undefined,
        matchPattern: form.matchPattern.trim() || undefined,
        sourceBillType: form.sourceBillType,
        allocationMethod: form.allocationMethod,
        defaultStage: form.defaultStage,
        priority: Number(form.priority) || 10,
        remark: form.remark.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-fee-rules'] });
      setShowForm(false);
      setForm(emptyForm);
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateRule = useMutation({
    mutationFn: (payload: {
      id: string;
      allocationMethod?: FobFeeRule['allocationMethod'];
      isActive?: boolean;
      priority?: number;
    }) => api.updateFobFeeRule(payload.id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fob-fee-rules'] }),
    onError: (e: Error) => setError(e.message),
  });

  const resetPriorities = useMutation({
    mutationFn: () => api.resetFobFeeRulePriorities(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fob-fee-rules'] });
      setError('');
      setSuccess(`已按模板重置 ${r.updated} 条规则优先级（拖车 → 货代）`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const grouped = useMemo(() => {
    const trucking = rules.filter((r) => r.sourceBillType === 'trucking');
    const freight = rules.filter((r) => r.sourceBillType === 'freight');
    if (filter === 'trucking') return [{ title: '拖车账单', rows: trucking }];
    if (filter === 'freight') return [{ title: '货代账单', rows: freight }];
    return [
      { title: '拖车账单', rows: trucking },
      { title: '货代账单', rows: freight },
    ];
  }, [rules, filter]);

  if (isLoading) return <p className="text-text-sub">加载规则中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-sub">
          导入模板宽表共 32 项拖车、23 项货代；优先级越大平账矩阵列越靠前（默认拖车先于货代）。精确费用名优先于模糊匹配。规则仅支持按体积 / 按票 / 需确认。分摊方式切换后立即保存；优先级修改后失焦保存。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={resetPriorities.isPending}
            onClick={() => setResetConfirmOpen(true)}
          >
            {resetPriorities.isPending ? '重置中...' : '重置列优先级'}
          </Button>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '新增规则'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', '全部'],
            ['trucking', '拖车'],
            ['freight', '货代'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'default' : 'outline'}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">新增分摊规则</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input
              placeholder="费用名称（精确），如 报关费"
              value={form.feeType}
              onChange={(e) => setForm((f) => ({ ...f, feeType: e.target.value }))}
            />
            <Input
              placeholder="模糊匹配（可选），如 海运费"
              value={form.matchPattern}
              onChange={(e) => setForm((f) => ({ ...f, matchPattern: e.target.value }))}
            />
            <select
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={form.sourceBillType}
              onChange={(e) =>
                setForm((f) => ({ ...f, sourceBillType: e.target.value as 'trucking' | 'freight' }))
              }
            >
              <option value="trucking">拖车账单</option>
              <option value="freight">货代账单</option>
            </select>
            <select
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={form.allocationMethod}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  allocationMethod: e.target.value as (typeof METHOD_OPTIONS)[number]['value'],
                }))
              }
            >
              {METHOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={form.defaultStage}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultStage: e.target.value as (typeof STAGE_OPTIONS)[number]['value'],
                }))
              }
            >
              {STAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Input
              placeholder="优先级（越大越优先）"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            />
            <Input
              className="md:col-span-2 lg:col-span-3"
              placeholder="备注（可选）"
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
            />
            <div className="flex gap-2 md:col-span-2 lg:col-span-3">
              <Button
                disabled={createRule.isPending || (!form.feeType.trim() && !form.matchPattern.trim())}
                onClick={() => createRule.mutate()}
              >
                保存
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-700">{success}</p>}

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="重置列优先级"
        description="按导入模板顺序重置全部费用优先级？拖车 32 项在前，货代 23 项在后。"
        confirmLabel="重置"
        loading={resetPriorities.isPending}
        onConfirm={() => resetPriorities.mutate()}
      />

      {grouped.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle className="text-base">{group.title}</CardTitle>
            <p className="text-sm text-text-sub">{group.rows.length} 条规则</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="p-2 font-normal">费用名</th>
                  <th className="p-2 font-normal">模糊匹配</th>
                  <th className="p-2 font-normal">分摊方式</th>
                  <th className="p-2 font-normal">阶段</th>
                  <th className="p-2 font-normal">优先级</th>
                  <th className="p-2 font-normal">状态</th>
                  <th className="p-2 font-normal">备注</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((rule) => (
                  <tr
                    key={rule.id}
                    className={cn('border-b border-border/40', !rule.isActive && 'opacity-50')}
                  >
                    <td className="p-2">{rule.feeType || '—'}</td>
                    <td className="p-2 text-text-sub">{rule.matchPattern || '—'}</td>
                    <td className="p-2">
                      {rule.allocationMethod === 'fixed' ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-amber-800">固定（已停用）</span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-fit text-xs"
                            disabled={updateRule.isPending}
                            onClick={() =>
                              updateRule.mutate({ id: rule.id, allocationMethod: 'manual' })
                            }
                          >
                            改为需确认
                          </Button>
                        </div>
                      ) : (
                        <select
                          className="h-8 min-w-[120px] rounded-md border border-input bg-card px-2 text-sm"
                          value={ruleMethodSelectValue(rule.allocationMethod)}
                          disabled={updateRule.isPending}
                          onChange={(e) =>
                            updateRule.mutate({
                              id: rule.id,
                              allocationMethod: e.target.value as RuleAllocationMethod,
                            })
                          }
                        >
                          {METHOD_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="p-2">{rule.defaultStage}</td>
                    <td className="p-2">
                      <Input
                        className="h-8 w-20 font-numeric text-sm"
                        type="number"
                        defaultValue={rule.priority}
                        disabled={updateRule.isPending}
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isFinite(next) || next === rule.priority) return;
                          updateRule.mutate({ id: rule.id, priority: next });
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={rule.isActive ? 'text-emerald-700' : 'text-text-hint'}
                        disabled={updateRule.isPending}
                        onClick={() =>
                          updateRule.mutate({ id: rule.id, isActive: !rule.isActive })
                        }
                      >
                        {rule.isActive ? '启用' : '停用'}
                      </Button>
                    </td>
                    <td className="max-w-[200px] truncate p-2 text-text-sub" title={rule.remark ?? ''}>
                      {rule.remark || '—'}
                    </td>
                  </tr>
                ))}
                {!group.rows.length && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-text-hint">
                      暂无规则
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
