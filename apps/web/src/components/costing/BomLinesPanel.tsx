import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CostingBomLine, type CostingBomLineInput } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type DraftLine = {
  category: string;
  materialName: string;
  spec: string;
  unit: string;
  qtyNet: string;
  lossPercent: string;
  unitPriceOverride: string;
};

const EMPTY_DRAFT: DraftLine = {
  category: '未分类',
  materialName: '',
  spec: '',
  unit: '',
  qtyNet: '0',
  lossPercent: '0',
  unitPriceOverride: '',
};

const MATCH_LABELS: Record<CostingBomLine['matchStatus'], string> = {
  exact: '精确匹配',
  name_only: '名称匹配',
  unmatched: '未匹配',
};

const CONFIDENCE_LABELS: Record<CostingBomLine['confidence'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

type BomLinesPanelProps = {
  projectId: string;
  lines: CostingBomLine[];
  readOnly: boolean;
};

export function BomLinesPanel({ projectId, lines, readOnly }: BomLinesPanelProps) {
  const queryClient = useQueryClient();
  const [showNewRow, setShowNewRow] = useState(false);
  const [draft, setDraft] = useState<DraftLine>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const queryKey = ['costing-project', projectId];

  const groups = useMemo(() => {
    const grouped = new Map<string, CostingBomLine[]>();
    for (const line of lines) {
      const category = line.category || '未分类';
      grouped.set(category, [...(grouped.get(category) ?? []), line]);
    }
    return [...grouped.entries()];
  }, [lines]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const createLine = useMutation({
    mutationFn: () =>
      api.createCostingBomLine(projectId, {
        category: draft.category,
        materialName: draft.materialName,
        spec: draft.spec,
        unit: draft.unit,
        qtyNet: Number(draft.qtyNet),
        lossRate: Number(draft.lossPercent) / 100,
        unitPriceOverride:
          draft.unitPriceOverride === '' ? null : Number(draft.unitPriceOverride),
        sourceRef: '手工',
        confidence: 'high',
      }),
    onSuccess: () => {
      setError('');
      setDraft(EMPTY_DRAFT);
      setShowNewRow(false);
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
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (cause: Error) => setError(cause.message),
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
    if (value === (line[key] ?? '')) return;
    patchLine.mutate({ lineId: line.id, patch: { [key]: value } });
  };

  const numberIsValid = (value: string) =>
    value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

  const renderLine = (line: CostingBomLine) => {
    const highlighted =
      line.confidence === 'low' || line.matchStatus === 'unmatched' || Number(line.qtyNet) === 0;
    return (
      <tr
        key={line.id}
        className={cn('border-b border-border/60', highlighted && 'bg-highlight-warm')}
      >
        <td className="p-1">
          <Input
            key={`${line.id}-materialName-${line.materialName}`}
            className="h-8 min-w-32 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.materialName}
            disabled={readOnly}
            onBlur={(event) => patchText(line, 'materialName', event.target.value)}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-spec-${line.spec ?? ''}`}
            className="h-8 min-w-28 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.spec ?? ''}
            disabled={readOnly}
            onBlur={(event) => patchText(line, 'spec', event.target.value)}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-unit-${line.unit}`}
            className="h-8 w-20 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.unit}
            disabled={readOnly}
            onBlur={(event) => patchText(line, 'unit', event.target.value)}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-qtyNet-${line.qtyNet}`}
            className="h-8 w-24 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
            type="number"
            min="0"
            step="0.0001"
            defaultValue={line.qtyNet}
            disabled={readOnly}
            onBlur={(event) => {
              if (numberIsValid(event.target.value) && Number(event.target.value) !== Number(line.qtyNet)) {
                patchLine.mutate({ lineId: line.id, patch: { qtyNet: Number(event.target.value) } });
              }
            }}
          />
        </td>
        <td className="p-1">
          <Input
            key={`${line.id}-loss-${line.lossRate}`}
            className="h-8 w-20 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
            type="number"
            min="0"
            step="0.01"
            defaultValue={Number(line.lossRate) * 100}
            aria-label="损耗百分比"
            disabled={readOnly}
            onBlur={(event) => {
              const nextRate = Number(event.target.value) / 100;
              if (numberIsValid(event.target.value) && nextRate !== Number(line.lossRate)) {
                patchLine.mutate({ lineId: line.id, patch: { lossRate: nextRate } });
              }
            }}
          />
        </td>
        <td className="p-2 font-mono">{Number(line.qtyGross).toFixed(4)}</td>
        <td className="p-2 whitespace-nowrap">{MATCH_LABELS[line.matchStatus]}</td>
        <td className="p-1">
          <Input
            key={`${line.id}-price-${line.unitPriceOverride ?? line.effectiveUnitPrice ?? ''}`}
            className="h-8 w-24 border-transparent bg-transparent px-2 font-mono focus-visible:border-input"
            type="number"
            min="0"
            step="0.0001"
            defaultValue={line.unitPriceOverride ?? line.effectiveUnitPrice ?? ''}
            placeholder="缺价"
            disabled={readOnly}
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
        <td className="p-1">
          <Input
            key={`${line.id}-source-${line.sourceRef ?? ''}`}
            className="h-8 min-w-24 border-transparent bg-transparent px-2 focus-visible:border-input"
            defaultValue={line.sourceRef ?? ''}
            disabled={readOnly}
            onBlur={(event) => patchText(line, 'sourceRef', event.target.value)}
          />
        </td>
        <td className="p-1">
          <select
            key={`${line.id}-confidence-${line.confidence}`}
            className="h-8 rounded-md border border-transparent bg-transparent px-2 text-sm"
            defaultValue={line.confidence}
            disabled={readOnly}
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
        <td className="p-1">
          {!readOnly && (
            <Button
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

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>材料清单</CardTitle>
          <p className="mt-1 text-sm text-text-hint">单元格修改后失焦即保存，损耗按百分比填写</p>
        </div>
        {!readOnly && (
          <Button variant="outline" onClick={() => setShowNewRow((value) => !value)}>
            {showNewRow ? '取消新增' : '手工添加'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {showNewRow && !readOnly && (
          <div className="mb-4 grid gap-3 rounded-md bg-muted/40 p-4 md:grid-cols-4">
            {(
              [
                ['category', '大类'],
                ['materialName', '名称'],
                ['spec', '规格'],
                ['unit', '单位'],
                ['qtyNet', '净用量'],
                ['lossPercent', '损耗（%）'],
                ['unitPriceOverride', '本单单价（可空）'],
              ] as const
            ).map(([key, placeholder]) => (
              <Input
                key={key}
                className={key === 'qtyNet' || key === 'lossPercent' || key === 'unitPriceOverride' ? 'font-mono' : ''}
                type={key === 'qtyNet' || key === 'lossPercent' || key === 'unitPriceOverride' ? 'number' : 'text'}
                min={key === 'qtyNet' || key === 'lossPercent' || key === 'unitPriceOverride' ? '0' : undefined}
                placeholder={placeholder}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            ))}
            <Button
              variant="outline"
              disabled={
                !draft.category.trim() ||
                !draft.materialName.trim() ||
                !draft.unit.trim() ||
                !numberIsValid(draft.qtyNet) ||
                !numberIsValid(draft.lossPercent) ||
                (draft.unitPriceOverride !== '' && !numberIsValid(draft.unitPriceOverride)) ||
                createLine.isPending
              }
              onClick={() => createLine.mutate()}
            >
              添加材料行
            </Button>
          </div>
        )}

        {groups.map(([category, categoryLines]) => (
          <section key={category} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-sm font-semibold text-text-main">
              {category}
              <span className="ml-2 font-normal text-text-hint">{categoryLines.length} 行</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    {[
                      '名称',
                      '规格',
                      '单位',
                      '净用量',
                      '损耗（%）',
                      '毛用量',
                      '匹配状态',
                      '生效单价',
                      '金额',
                      '来源',
                      '置信度',
                      '操作',
                    ].map((label) => (
                      <th key={label} className="p-2 font-normal">
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
