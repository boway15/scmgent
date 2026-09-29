import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type RuleScope = 'trucking' | 'freight';
type FobFeeRule = Awaited<ReturnType<typeof api.getFobFeeRules>>[number];
type FobPort = Awaited<ReturnType<typeof api.getFobPorts>>[number];

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

const TEMPLATE_PORT_CODE = '__TEMPLATE__';
const PORT_STORAGE_KEY = 'fob-fee-rules-selected-port-id';

const emptyForm = {
  feeType: '',
  matchPattern: '',
  allocationMethod: 'by_volume' as (typeof METHOD_OPTIONS)[number]['value'],
  defaultStage: 'other' as (typeof STAGE_OPTIONS)[number]['value'],
  priority: '10',
  remark: '',
};

function isTemplatePort(port: FobPort | undefined) {
  return port?.code === TEMPLATE_PORT_CODE;
}

function RulesTable({
  rows,
  emptyHint,
  updatePending,
  onUpdate,
}: {
  rows: FobFeeRule[];
  emptyHint: string;
  updatePending: boolean;
  onUpdate: (payload: {
    id: string;
    allocationMethod?: FobFeeRule['allocationMethod'];
    isActive?: boolean;
    priority?: number;
  }) => void;
}) {
  return (
    <div className="overflow-x-auto">
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
          {rows.map((rule) => (
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
                      disabled={updatePending}
                      onClick={() => onUpdate({ id: rule.id, allocationMethod: 'manual' })}
                    >
                      改为需确认
                    </Button>
                  </div>
                ) : (
                  <select
                    className="h-8 min-w-[120px] rounded-md border border-input bg-card px-2 text-sm"
                    value={ruleMethodSelectValue(rule.allocationMethod)}
                    disabled={updatePending}
                    onChange={(e) =>
                      onUpdate({
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
                  disabled={updatePending}
                  onBlur={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next) || next === rule.priority) return;
                    onUpdate({ id: rule.id, priority: next });
                  }}
                />
              </td>
              <td className="p-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className={rule.isActive ? 'text-emerald-700' : 'text-text-hint'}
                  disabled={updatePending}
                  onClick={() => onUpdate({ id: rule.id, isActive: !rule.isActive })}
                >
                  {rule.isActive ? '启用' : '停用'}
                </Button>
              </td>
              <td className="max-w-[200px] truncate p-2 text-text-sub" title={rule.remark ?? ''}>
                {rule.remark || '—'}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-text-hint">
                {emptyHint}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function FobFeeRulesPanel() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<RuleScope>('freight');
  const [selectedPortId, setSelectedPortId] = useState(() => {
    try {
      return sessionStorage.getItem(PORT_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [showPortForm, setShowPortForm] = useState(false);
  const [portName, setPortName] = useState('');
  const [editingPortName, setEditingPortName] = useState(false);
  const [portNameDraft, setPortNameDraft] = useState('');
  const [copySourcePortId, setCopySourcePortId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);

  const { data: ports = [], isLoading: portsLoading } = useQuery({
    queryKey: ['fob-ports'],
    queryFn: () => api.getFobPorts(),
  });

  const templatePort = useMemo(
    () => ports.find((p) => p.code === TEMPLATE_PORT_CODE),
    [ports],
  );
  const businessPorts = useMemo(
    () => ports.filter((p) => p.code !== TEMPLATE_PORT_CODE),
    [ports],
  );

  const freightPortId = useMemo(() => {
    if (selectedPortId && ports.some((p) => p.id === selectedPortId)) return selectedPortId;
    const firstBusiness = businessPorts.find((p) => p.isActive) ?? businessPorts[0];
    if (firstBusiness) return firstBusiness.id;
    return templatePort?.id ?? '';
  }, [selectedPortId, ports, businessPorts, templatePort]);

  useEffect(() => {
    if (!freightPortId) return;
    try {
      sessionStorage.setItem(PORT_STORAGE_KEY, freightPortId);
    } catch {
      /* ignore */
    }
  }, [freightPortId]);

  const selectPort = (id: string) => {
    setSelectedPortId(id);
    setScope('freight');
    setError('');
    setSuccess('');
    setShowForm(false);
    setEditingPortName(false);
    setPortNameDraft('');
  };

  const { data: allFreightRules = [] } = useQuery({
    queryKey: ['fob-fee-rules', 'freight-all-for-counts'],
    queryFn: () => api.getFobFeeRules({ sourceBillType: 'freight' }),
  });

  const ruleCountByPort = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allFreightRules) {
      if (!r.portId || !r.isActive) continue;
      map.set(r.portId, (map.get(r.portId) ?? 0) + 1);
    }
    return map;
  }, [allFreightRules]);

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['fob-fee-rules', scope, freightPortId],
    queryFn: () => {
      if (scope === 'trucking') return api.getFobFeeRules({ sourceBillType: 'trucking' });
      return api.getFobFeeRules({
        sourceBillType: 'freight',
        portId: freightPortId || undefined,
      });
    },
    enabled: scope === 'trucking' || !!freightPortId,
  });

  const selectedPort = ports.find((p) => p.id === freightPortId);
  const selectedCount = freightPortId ? (ruleCountByPort.get(freightPortId) ?? 0) : 0;
  const templateCount = templatePort ? (ruleCountByPort.get(templatePort.id) ?? 0) : 0;

  /** 可作为复制源：有启用规则、且不是当前目标港 */
  const copySourceOptions = useMemo(() => {
    return ports.filter((p) => {
      if (p.id === freightPortId) return false;
      return (ruleCountByPort.get(p.id) ?? 0) > 0;
    });
  }, [ports, freightPortId, ruleCountByPort]);

  const effectiveCopySourceId = useMemo(() => {
    if (copySourcePortId && copySourceOptions.some((p) => p.id === copySourcePortId)) {
      return copySourcePortId;
    }
    if (templatePort && copySourceOptions.some((p) => p.id === templatePort.id)) {
      return templatePort.id;
    }
    return copySourceOptions[0]?.id ?? '';
  }, [copySourcePortId, copySourceOptions, templatePort]);

  const copySourcePort = ports.find((p) => p.id === effectiveCopySourceId);
  const canCopyRules = !!selectedPort && !!effectiveCopySourceId && !!copySourcePort;

  useEffect(() => {
    if (!copySourcePortId && templatePort?.id) {
      setCopySourcePortId(templatePort.id);
    }
  }, [templatePort?.id, copySourcePortId]);

  const createPort = useMutation({
    mutationFn: () => api.createFobPort({ name: portName.trim() }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['fob-ports'] });
      setPortName('');
      setShowPortForm(false);
      selectPort((row as FobPort).id);
      setSuccess(`已创建港口「${(row as FobPort).name}」，可从其他港口复制规则后编辑`);
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const renamePort = useMutation({
    mutationFn: () => {
      if (!selectedPort || isTemplatePort(selectedPort)) {
        throw new Error('模板港口名称不可修改');
      }
      const name = portNameDraft.trim();
      if (!name) throw new Error('港口名称不能为空');
      return api.updateFobPort(selectedPort.id, { name });
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['fob-ports'] });
      setEditingPortName(false);
      setPortNameDraft('');
      setSuccess(
        `港口已改名为「${(row as FobPort).name}」。请确认体积文件「起运港」与新名称一致。`,
      );
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const copyRules = useMutation({
    mutationFn: () => {
      if (!effectiveCopySourceId || !freightPortId) throw new Error('请选择源港口与目标港口');
      return api.copyFobPortRules(freightPortId, effectiveCopySourceId);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fob-fee-rules'] });
      setCopyConfirmOpen(false);
      setSuccess(
        `已从「${r.sourcePortName}」复制 ${r.copied} 条规则到「${r.targetPortName}」，可在下方直接修改分摊方式`,
      );
      setError('');
    },
    onError: (e: Error) => setError(e.message),
  });

  const createRule = useMutation({
    mutationFn: () =>
      api.createFobFeeRule({
        feeType: form.feeType.trim() || undefined,
        matchPattern: form.matchPattern.trim() || undefined,
        sourceBillType: scope,
        allocationMethod: form.allocationMethod,
        defaultStage: form.defaultStage,
        priority: Number(form.priority) || 10,
        remark: form.remark.trim() || undefined,
        portId: scope === 'freight' ? freightPortId : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-fee-rules'] });
      setShowForm(false);
      setForm(emptyForm);
      setError('');
      setSuccess('规则已保存');
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-fee-rules'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const resetPriorities = useMutation({
    mutationFn: () => api.resetFobFeeRulePriorities(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['fob-fee-rules'] });
      setError('');
      setSuccess(`已按模板重置 ${r.updated} 条规则优先级`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const togglePortActive = useMutation({
    mutationFn: (port: FobPort) => api.updateFobPort(port.id, { isActive: !port.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fob-ports'] }),
    onError: (e: Error) => setError(e.message),
  });

  const isLoading = portsLoading || rulesLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors',
                scope === 'freight'
                  ? 'bg-primary text-white'
                  : 'text-text-sub hover:text-text-main',
              )}
              onClick={() => {
                setScope('freight');
                setShowForm(false);
              }}
            >
              货代规则 · 按港口
            </button>
            <button
              type="button"
              className={cn(
                'rounded px-3 py-1.5 text-sm transition-colors',
                scope === 'trucking'
                  ? 'bg-primary text-white'
                  : 'text-text-sub hover:text-text-main',
              )}
              onClick={() => {
                setScope('trucking');
                setShowForm(false);
              }}
            >
              拖车规则 · 全局
            </button>
          </div>
          <p className="text-sm text-text-sub">
            {scope === 'freight'
              ? '港口仅作用于货代：先选港口，再查看/编辑该港完整规则。体积「起运港」须与港口名称一致。'
              : '拖车不分港口，一套全局规则对所有拖车批次生效。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={resetPriorities.isPending}
            onClick={() => setResetConfirmOpen(true)}
          >
            {resetPriorities.isPending ? '重置中...' : '重置列优先级'}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setForm(emptyForm);
              setShowForm(!showForm);
            }}
            disabled={scope === 'freight' && !freightPortId}
          >
            {showForm ? '取消' : '新增规则'}
          </Button>
        </div>
      </div>

      {scope === 'freight' && (
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">选择起运港</CardTitle>
                <p className="mt-1 text-sm text-text-sub">
                  点击港口切换规则表；数字为启用中的货代规则条数
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowPortForm(!showPortForm)}>
                {showPortForm ? '取消' : '新增港口'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {businessPorts.map((p) => {
                const count = ruleCountByPort.get(p.id) ?? 0;
                const active = p.id === freightPortId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPort(p.id)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'border-primary bg-orange-50 text-text-main'
                        : 'border-border bg-card text-text-sub hover:border-primary/40',
                      !p.isActive && 'opacity-60',
                    )}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 font-numeric text-text-hint">{count} 条</span>
                    {!p.isActive && <span className="ml-1 text-xs text-text-hint">停用</span>}
                  </button>
                );
              })}
              {templatePort && (
                <button
                  type="button"
                  onClick={() => selectPort(templatePort.id)}
                  className={cn(
                    'rounded-md border border-dashed px-3 py-2 text-left text-sm transition-colors',
                    freightPortId === templatePort.id
                      ? 'border-primary bg-orange-50 text-text-main'
                      : 'border-border bg-layout text-text-hint hover:border-primary/40',
                  )}
                >
                  <span>模板港口</span>
                  <span className="ml-2 font-numeric">{templateCount} 条</span>
                  <span className="ml-1 text-xs">（仅供复制）</span>
                </button>
              )}
              {!portsLoading && !businessPorts.length && !templatePort && (
                <p className="text-sm text-text-hint">暂无港口，请先新增</p>
              )}
            </div>

            {showPortForm && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-layout p-3">
                <Input
                  className="max-w-xs bg-card"
                  placeholder="港口名称，须与体积「起运港」一致，如 盐田"
                  value={portName}
                  onChange={(e) => setPortName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && portName.trim()) createPort.mutate();
                  }}
                />
                <Button
                  size="sm"
                  disabled={!portName.trim() || createPort.isPending}
                  onClick={() => createPort.mutate()}
                >
                  {createPort.isPending ? '保存中...' : '保存'}
                </Button>
              </div>
            )}

            {selectedPort && (
              <div className="space-y-3 border-t border-border/60 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-text-main">
                    当前：<strong>{selectedPort.name}</strong>
                    <span className="ml-2 font-numeric text-text-sub">{selectedCount} 条规则</span>
                  </span>
                  {!isTemplatePort(selectedPort) && !editingPortName && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingPortName(true);
                        setPortNameDraft(selectedPort.name);
                      }}
                    >
                      改名
                    </Button>
                  )}
                  {!isTemplatePort(selectedPort) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={togglePortActive.isPending}
                      onClick={() => togglePortActive.mutate(selectedPort)}
                    >
                      {selectedPort.isActive ? '停用此港' : '启用此港'}
                    </Button>
                  )}
                  {isTemplatePort(selectedPort) && (
                    <span className="text-xs text-text-hint">
                      模板港不参与核算，请选真实港口维护规则
                    </span>
                  )}
                </div>

                {editingPortName && !isTemplatePort(selectedPort) && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-layout p-3">
                    <Input
                      className="max-w-xs bg-card"
                      value={portNameDraft}
                      placeholder="新港口名称"
                      onChange={(e) => setPortNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && portNameDraft.trim()) renamePort.mutate();
                        if (e.key === 'Escape') {
                          setEditingPortName(false);
                          setPortNameDraft('');
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      disabled={!portNameDraft.trim() || renamePort.isPending}
                      onClick={() => renamePort.mutate()}
                    >
                      {renamePort.isPending ? '保存中...' : '保存名称'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingPortName(false);
                        setPortNameDraft('');
                      }}
                    >
                      取消
                    </Button>
                    <p className="w-full text-xs text-text-hint">
                      改名后体积导入「起运港」须与新名称完全一致，否则无法匹配规则
                    </p>
                  </div>
                )}

                {canCopyRules && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-text-sub">从</span>
                    <select
                      className="h-9 min-w-[160px] rounded-md border border-input bg-card px-2 text-sm"
                      value={effectiveCopySourceId}
                      onChange={(e) => setCopySourcePortId(e.target.value)}
                    >
                      {copySourceOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code === TEMPLATE_PORT_CODE ? '模板港口' : p.name}
                          {`（${ruleCountByPort.get(p.id) ?? 0} 条）`}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-text-sub">复制规则到当前港</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={copyRules.isPending}
                      onClick={() => setCopyConfirmOpen(true)}
                    >
                      复制规则
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">
              新增{scope === 'freight' ? '货代' : '拖车'}规则
              {scope === 'freight' && selectedPort ? ` · ${selectedPort.name}` : ''}
            </CardTitle>
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
                disabled={
                  createRule.isPending ||
                  (!form.feeType.trim() && !form.matchPattern.trim()) ||
                  (scope === 'freight' && !freightPortId)
                }
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
        description="按导入模板顺序重置全部费用优先级？拖车项在前，货代项在后。"
        confirmLabel="重置"
        loading={resetPriorities.isPending}
        onConfirm={() => resetPriorities.mutate()}
      />

      <ConfirmDialog
        open={copyConfirmOpen}
        onOpenChange={setCopyConfirmOpen}
        title="复制港口规则"
        description={
          selectedPort && copySourcePort
            ? `将「${copySourcePort.code === TEMPLATE_PORT_CODE ? '模板港口' : copySourcePort.name}」的规则复制到「${selectedPort.name}」。已存在的同名费用项会跳过，不会覆盖。`
            : '请先选择源港口与目标港口'
        }
        confirmLabel="复制"
        loading={copyRules.isPending}
        onConfirm={() => copyRules.mutate()}
      />

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">
            {scope === 'trucking'
              ? '拖车规则（全局）'
              : `货代规则 · ${selectedPort?.name ?? '未选港口'}`}
          </CardTitle>
          <p className="text-sm text-text-sub">
            {isLoading ? '加载中…' : `${rules.length} 条`}
            {scope === 'freight' && selectedCount === 0 && canCopyRules
              ? ' · 当前港还没有规则，可从上方选择源港口复制'
              : ''}
          </p>
        </CardHeader>
        <CardContent>
          {scope === 'freight' && selectedCount === 0 && canCopyRules && !isLoading ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-primary/40 bg-orange-50/60 px-4 py-3">
              <p className="text-sm text-text-main">
                「{selectedPort?.name}」暂无货代规则。可从
                {copySourcePort
                  ? `「${copySourcePort.code === TEMPLATE_PORT_CODE ? '模板港口' : copySourcePort.name}」`
                  : '其他港口'}
                复制后再按港调整。
              </p>
              <Button size="sm" disabled={copyRules.isPending} onClick={() => setCopyConfirmOpen(true)}>
                复制规则
              </Button>
            </div>
          ) : null}
          {isLoading ? (
            <p className="p-4 text-sm text-text-sub">加载规则中...</p>
          ) : (
            <RulesTable
              rows={rules}
              emptyHint={
                scope === 'trucking'
                  ? '暂无拖车规则'
                  : canCopyRules
                    ? '暂无规则，请在上方选择源港口后点击「复制规则」'
                    : '暂无规则'
              }
              updatePending={updateRule.isPending}
              onUpdate={(payload) => updateRule.mutate(payload)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
