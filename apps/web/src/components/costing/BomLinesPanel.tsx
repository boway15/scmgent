import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CostingBomLine, type CostingBomLineInput, type CostingComputeBlocker, type CostingProvenanceTag } from '@/lib/api';
import { boardUsageAreaM2, composeBoardSpec, composeBoardSpecParts, specDisplayParts } from '@/lib/board-spec';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PriceBookBindPopover } from '@/components/costing/PriceBookBindPopover';
import { PriceBookPickerPanel } from '@/components/costing/PriceBookPickerPanel';
import { BomCategoryField, BomUnitField } from '@/components/costing/BomCategoryField';
import {
  BOM_LINE_CATEGORIES_FALLBACK,
  BOM_UNIT_HINTS,
  bomSpecPlaceholder,
  defaultLossPercentForCategory,
  defaultUnitForCategory,
} from '@/lib/bom-field-hints';

const SUBSTRATE_OPTIONS = ['颗粒板', '密度板', '多层实木板', '实木', '其他'] as const;

type DraftLine = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  substrate: string;
  qtyNet: string;
  lossPercent: string;
  unitPriceOverride: string;
};

const EMPTY_DRAFT: DraftLine = {
  category: '五金',
  materialName: '',
  spec: '',
  unit: '套',
  substrate: '',
  qtyNet: '0',
  lossPercent: '0',
  unitPriceOverride: '',
};

const MATCH_LABELS: Record<CostingBomLine['matchStatus'], string> = {
  exact: '精确匹配',
  name_only: '名称匹配',
  unmatched: '未匹配',
};

const MATCH_SCOPE_LABELS: Record<NonNullable<CostingBomLine['matchScope']>, string> = {
  factory: '工厂专用',
  region: '区域通用',
  global: '全局通用',
};

const CONFIDENCE_LABELS: Record<CostingBomLine['confidence'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const ORIGIN_LABELS: Record<string, string> = {
  explicit: '明示',
  template: '模板',
};

const PROVENANCE_STYLES: Record<CostingProvenanceTag, string> = {
  设计明示: 'bg-blue-50 text-blue-700',
  规则开料: 'bg-amber-50 text-amber-800',
  模板补全: 'bg-violet-50 text-violet-700',
  库价: 'bg-emerald-50 text-emerald-700',
  本单补价: 'bg-orange-50 text-orange-700',
  人工修改: 'bg-slate-100 text-slate-700',
};

function stickyFirstCellClass(highlighted: boolean) {
  return cn(
    'sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]',
    highlighted ? 'bg-highlight-warm' : 'bg-card',
  );
}

function stickyLastCellClass(highlighted: boolean) {
  return cn(
    'sticky right-0 z-10 shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)]',
    highlighted ? 'bg-highlight-warm' : 'bg-card',
  );
}

function captureScrollSnapshot(root: HTMLElement | null) {
  const containers = root
    ? [...root.querySelectorAll<HTMLElement>('[data-bom-scroll]')]
    : [];
  return {
    windowY: window.scrollY,
    containers: containers.map((el) => ({ el, scrollLeft: el.scrollLeft })),
  };
}

function restoreScrollSnapshot(snapshot: ReturnType<typeof captureScrollSnapshot> | null) {
  if (!snapshot) return;
  requestAnimationFrame(() => {
    window.scrollTo({ top: snapshot.windowY, left: 0 });
    for (const { el, scrollLeft } of snapshot.containers) {
      el.scrollLeft = scrollLeft;
    }
  });
}

type BomLinesPanelProps = {
  projectId: string;
  lines: CostingBomLine[];
  readOnly: boolean;
  patchDisabled?: boolean;
  blockers?: CostingComputeBlocker[];
  boardSectionHeader?: ReactNode;
  defaultSubstrate?: string | null;
  highlightLineId?: string | null;
  projectRegionId?: string | null;
  projectFactoryId?: string | null;
  bomLineCategories?: readonly string[];
};

export function BomLinesPanel({
  projectId,
  lines,
  readOnly,
  patchDisabled = false,
  blockers = [],
  boardSectionHeader,
  defaultSubstrate = null,
  highlightLineId = null,
  projectRegionId = null,
  projectFactoryId = null,
  bomLineCategories,
}: BomLinesPanelProps) {
  const categoryOptions = useMemo(() => {
    const merged = new Set<string>([
      ...(bomLineCategories ?? BOM_LINE_CATEGORIES_FALLBACK),
      ...lines.map((line) => line.category).filter(Boolean),
    ]);
    return [...merged].sort((left, right) => {
      const rank = (name: string) =>
        name === '板材' ? 0 : name === '五金' ? 1 : name === '包装' ? 2 : 3;
      const order = rank(left) - rank(right);
      if (order !== 0) return order;
      return left.localeCompare(right, 'zh-CN');
    });
  }, [bomLineCategories, lines]);
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<ReturnType<typeof captureScrollSnapshot> | null>(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const [showBindPicker, setShowBindPicker] = useState(false);
  const [draft, setDraft] = useState<DraftLine>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const queryKey = ['costing-project', projectId];

  const captureScroll = () => {
    pendingScrollRestoreRef.current = captureScrollSnapshot(panelRef.current);
  };

  useEffect(() => {
    if (!pendingScrollRestoreRef.current) return;
    restoreScrollSnapshot(pendingScrollRestoreRef.current);
    pendingScrollRestoreRef.current = null;
  }, [lines]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  useEffect(() => {
    if (!highlightLineId) return;
    const element = document.getElementById(`costing-line-${highlightLineId}`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightLineId, lines]);

  const groups = useMemo(() => {
    const grouped = new Map<string, CostingBomLine[]>();
    for (const line of lines) {
      const category = line.category || '未分类';
      grouped.set(category, [...(grouped.get(category) ?? []), line]);
    }
    return [...grouped.entries()].sort((left, right) => {
      const rank = (name: string) =>
        name === '板材' ? 0 : name === '五金' ? 1 : name === '包装' ? 2 : 3;
      const order = rank(left[0]) - rank(right[0]);
      if (order !== 0) return order;
      return left[0].localeCompare(right[0], 'zh-CN');
    });
  }, [lines]);

  const numberIsValid = (value: string) =>
    value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

  const buildDraftPayload = (): CostingBomLineInput => ({
    category: draft.category.trim(),
    materialName: draft.materialName,
    spec: draft.spec,
    unit: draft.unit,
    qtyNet: Number(draft.qtyNet),
    lossRate: Number(draft.lossPercent) / 100,
    unitPriceOverride:
      draft.unitPriceOverride === '' ? null : Number(draft.unitPriceOverride),
    sourceRef: '手工',
    confidence: 'high',
    substrate: draft.category.trim() === '板材' ? draft.substrate || defaultSubstrate || null : null,
  });

  const isDraftValid =
    Boolean(draft.category.trim()) &&
    Boolean(draft.materialName.trim()) &&
    Boolean(draft.unit.trim()) &&
    numberIsValid(draft.qtyNet) &&
    numberIsValid(draft.lossPercent) &&
    (draft.unitPriceOverride === '' || numberIsValid(draft.unitPriceOverride));

  const resetDraftForm = () => {
    setDraft(EMPTY_DRAFT);
    setShowBindPicker(false);
    setShowNewRow(false);
  };

  const createLine = useMutation({
    mutationFn: () => api.createCostingBomLine(projectId, buildDraftPayload()),
    onSuccess: () => {
      setError('');
      resetDraftForm();
      refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const createAndBindLine = useMutation({
    mutationFn: async (priceBookId: string) => {
      const created = await api.createCostingBomLine(projectId, {
        ...buildDraftPayload(),
        unitPriceOverride: null,
      });
      if (!created.id) throw new Error('创建清单行失败');
      await api.bindCostingBomLinePriceBook(projectId, created.id, priceBookId);
    },
    onSuccess: () => {
      setError('');
      resetDraftForm();
      refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const patchLine = useMutation({
    mutationFn: ({
      lineId,
      patch,
    }: {
      lineId: string;
      patch: Partial<CostingBomLineInput>;
    }) => api.patchCostingBomLine(projectId, lineId, patch),
    onMutate: () => {
      captureScroll();
    },
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (cause: Error) => {
      if (/404|清单行不存在/.test(cause.message)) {
        refresh();
        setError('清单已刷新，请重新编辑该行');
        return;
      }
      setError(cause.message);
    },
  });

  const deleteLine = useMutation({
    mutationFn: (lineId: string) => api.deleteCostingBomLine(projectId, lineId),
    onSuccess: () => refresh(),
    onError: (cause: Error) => setError(cause.message),
  });

  const patchText = (
    line: CostingBomLine,
    key: 'category' | 'materialName' | 'spec' | 'unit' | 'sourceRef',
    value: string,
  ) => {
    if (patchDisabled || readOnly) return;
    if (value === (line[key] ?? '')) return;
    patchLine.mutate({ lineId: line.id, patch: { [key]: value } });
  };

  const renderLine = (line: CostingBomLine) => {
    const lineBlockers = blockers.filter(
      (item) => item.lineId === line.id || (!item.lineId && item.materialName === line.materialName),
    );
    const missingQty = lineBlockers.some((item) => item.reason === 'missing_qty');
    const missingPrice = lineBlockers.some((item) => item.reason === 'missing_price');
    const highlighted =
      line.id === highlightLineId ||
      lineBlockers.length > 0 ||
      line.confidence === 'low' ||
      line.matchStatus === 'unmatched' ||
      Number(line.qtyNet) === 0;
    const provenanceTags = line.provenanceTags ?? [];
    const board = specDisplayParts(line.spec);
    const usageArea = boardUsageAreaM2(line.spec, Number(line.qtyNet), Number(line.lossRate));
    return (
      <tr
        key={line.id}
        id={`costing-line-${line.id}`}
        className={cn(
          'border-b border-border/60',
          highlighted && 'bg-highlight-warm ring-1 ring-inset ring-primary/30',
        )}
      >
        <td className={cn('p-1', stickyFirstCellClass(highlighted))}>
          <Input
            key={`${line.id}-materialName`}
            className="h-8 min-w-32 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.materialName}
            disabled={readOnly || patchDisabled}
            title={line.extractDiff ?? undefined}
            onBlur={(event) => patchText(line, 'materialName', event.target.value)}
          />
          {line.extractDiff ? (
            <p className="px-2 text-xs text-text-hint">提取：{line.extractDiff}</p>
          ) : null}
          {missingQty ? (
            <p className="px-2 text-xs text-text-hint">缺用量：按尺寸图最后一道标注补规格与数量</p>
          ) : null}
          {missingPrice && !missingQty ? (
            <p className="px-2 text-xs text-text-hint">缺价：未匹配成本库时请填本单单价</p>
          ) : null}
        </td>
        <td className="p-1">
          {line.category === '板材' ? (
            <select
              key={`${line.id}-substrate`}
              className="h-8 min-w-24 rounded-md border border-transparent bg-transparent px-2 text-sm"
              aria-label="材质"
              defaultValue={line.substrate?.trim() || defaultSubstrate || ''}
              disabled={readOnly || patchDisabled}
              onChange={(event) => {
                const next = event.target.value;
                if (next === (line.substrate ?? '')) return;
                patchLine.mutate({ lineId: line.id, patch: { substrate: next || null } });
              }}
            >
              {!line.substrate && !defaultSubstrate ? <option value="">未选</option> : null}
              {SUBSTRATE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <span className="px-2 text-text-hint">—</span>
          )}
        </td>
        <td className="p-1">
          {line.category === '板材' ? (
            <Input
              key={`${line.id}-thickness`}
              className="h-8 w-20 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
              defaultValue={board.thickness}
              placeholder="18mm"
              aria-label="厚度"
              disabled={readOnly || patchDisabled}
              onBlur={(event) => {
                const next = composeBoardSpecParts(line.spec, { thickness: event.target.value });
                if (next !== (line.spec ?? '')) patchText(line, 'spec', next);
              }}
            />
          ) : (
            <span className="px-2 text-text-hint">—</span>
          )}
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-spec`}
            className="h-8 min-w-28 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={board.size}
            placeholder={missingQty ? '宽×高，如抽面开料' : ''}
            disabled={readOnly || patchDisabled}
            onBlur={(event) => patchText(line, 'spec', composeBoardSpec(line.spec, event.target.value))}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-unit`}
            className="h-8 w-20 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.unit}
            disabled={readOnly || patchDisabled}
            onBlur={(event) => patchText(line, 'unit', event.target.value)}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-qtyNet`}
            className="h-8 w-24 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
            type="number"
            min="0"
            step="0.0001"
            defaultValue={line.qtyNet}
            disabled={readOnly || patchDisabled}
            onBlur={(event) => {
              if (numberIsValid(event.target.value) && Number(event.target.value) !== Number(line.qtyNet)) {
                patchLine.mutate({ lineId: line.id, patch: { qtyNet: Number(event.target.value) } });
              }
            }}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-loss`}
            className="h-8 w-20 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
            type="number"
            min="0"
            step="0.01"
            defaultValue={Number(line.lossRate) * 100}
            aria-label="损耗百分比"
            disabled={readOnly || patchDisabled}
            onBlur={(event) => {
              const nextRate = Number(event.target.value) / 100;
              if (numberIsValid(event.target.value) && nextRate !== Number(line.lossRate)) {
                patchLine.mutate({ lineId: line.id, patch: { lossRate: nextRate } });
              }
            }}
          />
        </td>
        <td className="p-2 font-mono">
          {usageArea !== null ? `${usageArea.toFixed(4)} m²` : Number(line.qtyGross).toFixed(4)}
        </td>
        <td className="p-2 whitespace-nowrap">
          <div className="flex flex-col items-start gap-0.5">
            <span>{MATCH_LABELS[line.matchStatus]}</span>
            {(line.matchStatus === 'unmatched' || line.matchStatus === 'name_only') &&
            !readOnly &&
            !patchDisabled ? (
              <PriceBookBindPopover
                projectId={projectId}
                line={line}
                projectRegionId={projectRegionId}
                projectFactoryId={projectFactoryId}
                disabled={patchDisabled}
                onMutate={captureScroll}
                onBound={refresh}
                onError={(message) => setError(message)}
              />
            ) : null}
          </div>
        </td>
        <td className="p-2 whitespace-nowrap">
          {line.matchScope ? MATCH_SCOPE_LABELS[line.matchScope] : '—'}
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-price`}
            className="h-8 w-24 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
            type="number"
            min="0"
            step="0.0001"
            defaultValue={line.unitPriceOverride ?? line.effectiveUnitPrice ?? ''}
            placeholder={line.matchStatus === 'unmatched' ? '本单补价' : '缺价'}
            disabled={readOnly || patchDisabled}
            onBlur={(event) => {
              const raw = event.target.value;
              if (raw === '' && line.unitPriceOverride !== null) {
                patchLine.mutate({ lineId: line.id, patch: { unitPriceOverride: null } });
              } else if (
                numberIsValid(raw) &&
                Number(raw) !== (line.effectiveUnitPrice ?? null)
              ) {
                patchLine.mutate({
                  lineId: line.id,
                  patch: { unitPriceOverride: Number(raw) },
                });
              }
            }}
          />
        </td>
        <td className="p-2 text-right font-mono">¥{line.lineAmount.toFixed(2)}</td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            {provenanceTags.length
              ? provenanceTags.map((tag) => (
                  <span
                    key={tag}
                    className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-xs whitespace-nowrap',
                      PROVENANCE_STYLES[tag],
                    )}
                  >
                    {tag}
                  </span>
                ))
              : (
                <span className="text-text-hint">{ORIGIN_LABELS[line.origin] ?? line.origin}</span>
              )}
          </div>
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-source`}
            className="h-8 min-w-24 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.sourceRef ?? ''}
            disabled={readOnly || patchDisabled}
            onBlur={(event) => patchText(line, 'sourceRef', event.target.value)}
          />
        </td>
        <td className="p-1">
          <select
            key={`${line.id}-confidence`}
            className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm"
            defaultValue={line.confidence}
            disabled={readOnly || patchDisabled}
            onChange={(event) =>
              patchLine.mutate({
                lineId: line.id,
                patch: { confidence: event.target.value as CostingBomLine['confidence'] },
              })
            }
          >
            {(['high', 'medium', 'low'] as const).map((value) => (
              <option key={value} value={value}>
                {CONFIDENCE_LABELS[value]}
              </option>
            ))}
          </select>
        </td>
        <td className={cn('p-1', stickyLastCellClass(highlighted))}>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deleteLine.isPending}
              onClick={() => deleteLine.mutate(line.id)}
            >
              删除
            </Button>
          )}
        </td>
      </tr>
    );
  };

  const unitHints =
    BOM_UNIT_HINTS[draft.category.trim()] ?? BOM_UNIT_HINTS.其他;

  const updateDraftCategory = (nextCategory: string) => {
    setDraft((current) => {
      const trimmed = nextCategory.trim();
      const categoryChanged = trimmed !== current.category.trim();
      return {
        ...current,
        category: nextCategory,
        ...(categoryChanged
          ? {
              unit: current.unit.trim() ? current.unit : defaultUnitForCategory(trimmed),
              lossPercent:
                current.lossPercent === '0' || current.lossPercent === ''
                  ? defaultLossPercentForCategory(trimmed)
                  : current.lossPercent,
              substrate:
                trimmed === '板材' ? current.substrate || defaultSubstrate || '' : '',
            }
          : {}),
      };
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>材料清单</CardTitle>
          <p className="mt-1 text-sm text-text-hint">
            板材规格写「厚度 + 长×宽 mm」。材质下拉可改，计价按该行材质匹配张价。厚度、开料尺寸均可改，失焦后请再点「计算成本」。
          </p>
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            onClick={() => {
              if (showNewRow) {
                setShowBindPicker(false);
                setDraft(EMPTY_DRAFT);
              }
              setShowNewRow((value) => !value);
            }}
          >
            {showNewRow ? '取消新增' : '手工添加'}
          </Button>
        )}
      </CardHeader>
      <CardContent ref={panelRef}>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {showNewRow && !readOnly && (
          <div className="mb-4 space-y-3 rounded-md bg-muted/40 p-4">
            <p className="text-xs text-text-sub">
              大类可从列表选择或自行输入；板材类请补材质。已知成本库条目时，用「添加并绑价目」一步完成。
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <BomCategoryField
                value={draft.category}
                options={categoryOptions}
                onChange={updateDraftCategory}
              />
              <Input
                placeholder="名称"
                value={draft.materialName}
                onChange={(event) => setDraft({ ...draft, materialName: event.target.value })}
              />
              <Input
                placeholder={bomSpecPlaceholder(draft.category)}
                value={draft.spec}
                onChange={(event) => setDraft({ ...draft, spec: event.target.value })}
              />
              <BomUnitField
                value={draft.unit}
                category={draft.category}
                unitHints={unitHints}
                onChange={(value) => setDraft({ ...draft, unit: value })}
              />
              {draft.category.trim() === '板材' ? (
                <select
                  className="h-10 rounded-md border border-input bg-card px-3 text-sm"
                  aria-label="材质"
                  value={draft.substrate || defaultSubstrate || ''}
                  onChange={(event) => setDraft({ ...draft, substrate: event.target.value })}
                >
                  {!draft.substrate && !defaultSubstrate ? <option value="">未选</option> : null}
                  {SUBSTRATE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="hidden md:block" aria-hidden />
              )}
              <Input
                className="font-mono"
                type="number"
                min="0"
                step="0.0001"
                placeholder="数量"
                value={draft.qtyNet}
                onChange={(event) => setDraft({ ...draft, qtyNet: event.target.value })}
              />
              <Input
                className="font-mono"
                type="number"
                min="0"
                step="0.01"
                placeholder="损耗（%）"
                value={draft.lossPercent}
                onChange={(event) => setDraft({ ...draft, lossPercent: event.target.value })}
              />
              <Input
                className="font-mono"
                type="number"
                min="0"
                step="0.0001"
                placeholder="本单单价（可空）"
                value={draft.unitPriceOverride}
                onChange={(event) => setDraft({ ...draft, unitPriceOverride: event.target.value })}
              />
              <div className="flex flex-wrap gap-2 md:col-span-4">
                <Button
                  variant="outline"
                  disabled={!isDraftValid || createLine.isPending || createAndBindLine.isPending}
                  onClick={() => createLine.mutate()}
                >
                  添加材料行
                </Button>
                <Button
                  variant="default"
                  disabled={!isDraftValid || createLine.isPending || createAndBindLine.isPending}
                  onClick={() => setShowBindPicker((value) => !value)}
                >
                  {showBindPicker ? '收起价目' : '添加并绑价目'}
                </Button>
              </div>
            </div>
            {showBindPicker ? (
              <PriceBookPickerPanel
                category={draft.category}
                defaultKeyword={draft.materialName}
                projectRegionId={projectRegionId}
                projectFactoryId={projectFactoryId}
                selecting={createAndBindLine.isPending}
                onSelect={(item) => createAndBindLine.mutate(item.id)}
              />
            ) : null}
          </div>
        )}

        {boardSectionHeader && !groups.some(([category]) => category === '板材')
          ? boardSectionHeader
          : null}

        {groups.map(([category, categoryLines]) => (
          <section key={category} className="mb-5 last:mb-0">
            {category === '板材' ? boardSectionHeader : null}
            <h3 className="mb-2 text-sm font-semibold text-text-main">
              {category === '五金' ? '五金配件' : category}
              <span className="ml-2 font-normal text-text-hint">{categoryLines.length} 行</span>
            </h3>
            <div className="overflow-x-auto" data-bom-scroll>
              <table className="w-full min-w-[1680px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    {[
                      '名称',
                      '材质',
                      '厚度',
                      '规格',
                      '单位',
                      '数量',
                      '损耗（%）',
                      '用量',
                      '匹配状态',
                      '价层',
                      '生效单价',
                      '金额',
                      '来源',
                      '出处',
                      '置信度',
                      '操作',
                    ].map((label, index, labels) => (
                      <th
                        key={label}
                        className={cn(
                          'p-2 font-normal',
                          index === 0 &&
                            'sticky left-0 z-20 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]',
                          index === labels.length - 1 &&
                            'sticky right-0 z-20 bg-card shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.08)]',
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>{categoryLines.map(renderLine)}</tbody>
              </table>
            </div>
          </section>
        ))}

        {!lines.length && (
          <p className="py-8 text-center text-sm text-text-hint">
            暂无材料行，可点击「手工添加」开始核算
          </p>
        )}
      </CardContent>
    </Card>
  );
}
