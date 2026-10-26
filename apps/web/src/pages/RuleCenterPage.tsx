import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type RuleModuleView,
  type RuleParamSetStatus,
  type RuleParamSetView,
  type RuleParamSpec,
  type RuleSimulationRow,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn, formatDateTimeCst } from '@/lib/utils';

const STATUS_LABEL: Record<RuleParamSetStatus, string> = {
  draft: '草稿',
  pending_approval: '待审批',
  active: '生效中',
  archived: '已归档',
};

const SCOPE_LABEL: Record<string, string> = {
  global: '全局',
  project_group: '项目组',
  category: '品类',
  warehouse: '仓库',
  sku: 'SKU',
};

function scopeText(set: Pick<RuleParamSetView, 'scopeType' | 'scopeValue'>): string {
  return set.scopeType === 'global' ? '全局' : `${SCOPE_LABEL[set.scopeType] ?? set.scopeType}：${set.scopeValue}`;
}

function formatValue(spec: RuleParamSpec, value: unknown): string {
  if (value === undefined) return '—';
  if (spec.kind === 'boolean') return value ? '开' : '关';
  if (spec.kind === 'enum') return spec.options.find((o) => o.value === value)?.label ?? String(value);
  return `${value}${spec.unit ? ` ${spec.unit}` : ''}`;
}

function ParamInput(props: { spec: RuleParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  const { spec, value, onChange } = props;
  if (spec.kind === 'boolean') {
    return (
      <select
        className="h-8 rounded-md border px-2 text-sm"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
      >
        <option value="">不覆盖</option>
        <option value="true">开</option>
        <option value="false">关</option>
      </select>
    );
  }
  if (spec.kind === 'enum') {
    return (
      <select
        className="h-8 rounded-md border px-2 text-sm"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="">不覆盖</option>
        {spec.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Input
      className="h-8 w-28 font-mono"
      type="number"
      step={spec.kind === 'int' ? 1 : 0.01}
      min={spec.min}
      max={spec.max}
      placeholder="不覆盖"
      value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

function DraftEditor(props: {
  module: RuleModuleView;
  canEdit: boolean;
  onCreated: () => void;
}) {
  const { module, canEdit, onCreated } = props;
  const [scopeType, setScopeType] = useState(module.scopes[0] ?? 'global');
  const [scopeValue, setScopeValue] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.createRuleParamSet(module.code, {
        scopeType,
        scopeValue: scopeType === 'global' ? undefined : scopeValue,
        params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)),
        note,
      }),
    onSuccess: () => {
      setParams({});
      setNote('');
      setError(null);
      onCreated();
    },
    onError: (err: Error) => setError(err.message),
  });
  if (!canEdit) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">新建草稿</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span>作用范围</span>
          <select
            className="h-8 rounded-md border px-2"
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value)}
          >
            {module.scopes.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s] ?? s}
              </option>
            ))}
          </select>
          {scopeType !== 'global' && (
            <Input
              className="h-8 w-40"
              placeholder={scopeType === 'warehouse' ? '仓码，如 UK' : '项目组编码'}
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
            />
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {Object.entries(module.params).map(([key, spec]) => (
            <label key={key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span title={spec.help}>
                {spec.label}
                <span className="ml-1 text-xs text-text-sub">默认 {formatValue(spec, spec.default)}</span>
              </span>
              <ParamInput
                spec={spec}
                value={params[key]}
                onChange={(v) => setParams((prev) => ({ ...prev, [key]: v }))}
              />
            </label>
          ))}
        </div>
        <Input placeholder="修改说明（必填）" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          保存草稿
        </Button>
      </CardContent>
    </Card>
  );
}

function SimulationPanel(props: { module: RuleModuleView; set: RuleParamSetView; onDone: () => void }) {
  const [skuText, setSkuText] = useState('');
  const [projectGroup, setProjectGroup] = useState('');
  const [rows, setRows] = useState<RuleSimulationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () =>
      api.simulateRuleParamSet(props.module.code, props.set.id, {
        skuCodes: skuText.split(/[\s,，]+/).filter(Boolean),
        projectGroup: projectGroup || undefined,
      }),
    onSuccess: (data) => {
      setRows(data.rows);
      setError(null);
      props.onDone();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 w-72"
          placeholder="SKU 编码，逗号或空格分隔（最多 50 个）"
          value={skuText}
          onChange={(e) => setSkuText(e.target.value)}
        />
        <Input
          className="h-8 w-40"
          placeholder="或项目组"
          value={projectGroup}
          onChange={(e) => setProjectGroup(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? '试算中…' : '试算'}
        </Button>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {rows && rows.length === 0 && <p>与当前生效参数相比，建议无变化。</p>}
      {rows && rows.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-text-sub">
              <th className="py-1">SKU</th>
              <th>仓</th>
              <th>当前建议量</th>
              <th>草稿建议量</th>
              <th>当前灯</th>
              <th>草稿灯</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.skuCode}-${r.warehouseCode}`} className="border-t">
                <td className="py-1">{r.skuCode}</td>
                <td>{r.warehouseCode === 'NETWORK' ? '网络' : r.warehouseCode}</td>
                <td className="font-mono">{r.before?.suggestedQty ?? '不建议'}</td>
                <td className="font-mono">{r.after?.suggestedQty ?? '不建议'}</td>
                <td>{r.before?.healthStatus ?? '—'}</td>
                <td>{r.after?.healthStatus ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ParamSetList(props: {
  module: RuleModuleView;
  sets: RuleParamSetView[];
  canEdit: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const { module, sets, canEdit, isAdmin, onChanged } = props;
  const [openSim, setOpenSim] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: (input: { id: string; action: 'submit' | 'approve' | 'reject' | 'restore'; reviewNote?: string }) =>
      api.ruleParamSetAction(module.code, input.id, input.action, { reviewNote: input.reviewNote }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">参数集</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {sets.length === 0 && <p className="text-text-sub">暂无参数集，全部使用默认值。</p>}
        {sets.map((set) => (
          <div key={set.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{scopeText(set)}</span>
              <span className="text-text-sub">v{set.version}</span>
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs',
                  set.status === 'active' && 'bg-green-100 text-green-700',
                  set.status === 'pending_approval' && 'bg-orange-100 text-orange-700',
                  set.status === 'draft' && 'bg-muted',
                  set.status === 'archived' && 'text-text-hint',
                )}
              >
                {STATUS_LABEL[set.status]}
              </span>
              <span className="text-xs text-text-sub">{formatDateTimeCst(set.updatedAt)}</span>
              <span className="ml-auto flex gap-2">
                {canEdit && set.status === 'draft' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setOpenSim(openSim === set.id ? null : set.id)}>
                      试算
                    </Button>
                    <Button
                      size="sm"
                      disabled={!set.simulatedAt || action.isPending}
                      title={set.simulatedAt ? undefined : '请先试算'}
                      onClick={() => action.mutate({ id: set.id, action: 'submit' })}
                    >
                      提交审批
                    </Button>
                  </>
                )}
                {isAdmin && set.status === 'pending_approval' && (
                  <>
                    <Button size="sm" onClick={() => action.mutate({ id: set.id, action: 'approve' })}>
                      审批生效
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const reviewNote = window.prompt('驳回原因');
                        if (reviewNote) action.mutate({ id: set.id, action: 'reject', reviewNote });
                      }}
                    >
                      驳回
                    </Button>
                  </>
                )}
                {canEdit && set.status === 'archived' && (
                  <Button size="sm" variant="outline" onClick={() => action.mutate({ id: set.id, action: 'restore' })}>
                    恢复为草稿
                  </Button>
                )}
              </span>
            </div>
            <ul className="mt-2 grid gap-1 md:grid-cols-2">
              {Object.entries(set.params).map(([key, value]) => {
                const spec = module.params[key];
                return (
                  <li key={key}>
                    {spec ? spec.label : `${key}（已废弃）`}：{spec ? formatValue(spec, value) : String(value)}
                  </li>
                );
              })}
            </ul>
            {set.note && <p className="mt-1 text-xs text-text-sub">说明：{set.note}</p>}
            {set.reviewNote && <p className="mt-1 text-xs text-destructive">驳回原因：{set.reviewNote}</p>}
            {openSim === set.id && <SimulationPanel module={module} set={set} onDone={onChanged} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EffectiveTable(props: { module: RuleModuleView; sets: RuleParamSetView[] }) {
  const active = props.sets.filter((s) => s.status === 'active');
  const global = active.find((s) => s.scopeType === 'global');
  const overrides = active.filter((s) => s.scopeType !== 'global');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">当前生效参数</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-text-sub">
              <th className="py-1">参数</th>
              <th>默认值</th>
              <th>全局</th>
              <th>覆盖</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(props.module.params).map(([key, spec]) => (
              <tr key={key} className="border-t">
                <td className="py-1" title={spec.help}>
                  {spec.label}
                </td>
                <td className="font-mono">{formatValue(spec, spec.default)}</td>
                <td className="font-mono">{global && key in global.params ? formatValue(spec, global.params[key]) : '—'}</td>
                <td>
                  {overrides
                    .filter((s) => key in s.params)
                    .map((s) => `${scopeText(s)} = ${formatValue(spec, s.params[key])}`)
                    .join('；') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function RuleCenterPage() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const roleCode = user?.role.code ?? '';
  const isAdmin = roleCode === 'super_admin';
  const canEdit = isAdmin || roleCode === 'pmc_planner';
  const modulesQuery = useQuery({ queryKey: ['rule-modules'], queryFn: api.getRuleModules });
  const modules = modulesQuery.data?.items ?? [];
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const module = useMemo(
    () => modules.find((m) => m.code === activeCode) ?? modules[0],
    [modules, activeCode],
  );
  const setsQuery = useQuery({
    queryKey: ['rule-param-sets', module?.code],
    queryFn: () => api.getRuleParamSets(module!.code),
    enabled: Boolean(module),
  });
  const sets = setsQuery.data?.items ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rule-param-sets', module?.code] });

  return (
    <div className="space-y-4">
      <PageHeader title="规则中心" description="按模块管理供应链规则参数；草稿需试算并经管理员审批后生效" />
      <div className="flex gap-2 border-b">
        {modules.map((m) => (
          <button
            key={m.code}
            type="button"
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              m.code === module?.code ? 'border-primary font-medium' : 'border-transparent text-text-sub',
            )}
            onClick={() => setActiveCode(m.code)}
          >
            {m.name}
          </button>
        ))}
      </div>
      {module && (
        <>
          <p className="text-sm text-text-sub">{module.description}</p>
          <EffectiveTable module={module} sets={sets} />
          <DraftEditor module={module} canEdit={canEdit} onCreated={refresh} />
          <ParamSetList module={module} sets={sets} canEdit={canEdit} isAdmin={isAdmin} onChanged={refresh} />
        </>
      )}
    </div>
  );
}
