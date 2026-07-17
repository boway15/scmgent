import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, CircleCheck } from 'lucide-react';
import { buildFeePriorityMap, sortFeeChecksByDisplayPriority } from '@/lib/fob-fee-display-priority';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

type ContainerCheck = {
  containerNo: string;
  feeType: string;
  sourceBillType: 'trucking' | 'freight';
  sourceBillItemId: string;
  sourceAmountCny: number;
  allocatedCny: number;
  diffCny: number;
};

type ContainerFeeGroup = {
  containerNo: string;
  checks: ContainerCheck[];
  billTotal: number;
  allocatedTotal: number;
  diffTotal: number;
  balanced: boolean;
};

type ContainerStatRow = {
  containerNo: string;
  merchantCode: string;
  merchantName: string | null;
  volumeCbm: string;
  ticketCount: number;
  businessNos?: string;
};

type MerchantRow = {
  code: string;
  name: string | null;
  volumeCbm: number;
  volumeRatio: number;
};

type AllocationItem = {
  id: string;
  containerNo: string;
  merchantCode: string;
  merchantName: string | null;
  sourceBillItemId: string | null;
  allocatedAmountCny: string;
  allocationMethod?: string;
};

type FeeRule = {
  feeType: string | null;
  sourceBillType: string;
  matchPattern: string | null;
  priority: number;
  allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
};

type GlobalColumn = {
  key: string;
  feeType: string;
  sourceBillType: 'trucking' | 'freight';
  allocationMethod: string;
};

type PreparedGroup = {
  group: ContainerFeeGroup;
  scopedChecks: ContainerCheck[];
  scopeTotals: ReturnType<typeof computeScopeTotals>;
  merchants: MerchantRow[];
  checkByKey: Map<string, ContainerCheck>;
};

export type MatrixBillScope = 'trucking' | 'freight';

const SETTLEMENT_TYPE_LABEL: Record<MatrixBillScope, string> = {
  trucking: '拖车分账',
  freight: '货代分账',
};

/** 前四列冻结区总宽度（px） */
const FROZEN_COL_WIDTHS = [168, 80, 88, 88] as const;
const FROZEN_TOTAL_WIDTH = FROZEN_COL_WIDTHS.reduce((sum, w) => sum + w, 0);
const FEE_COL_WIDTH = 96;

function feeColStyle(): CSSProperties {
  return {
    width: FEE_COL_WIDTH,
    minWidth: FEE_COL_WIDTH,
    maxWidth: FEE_COL_WIDTH,
  };
}

const feeColClass = 'overflow-hidden min-w-0';

const ROW_H_PARENT = 'min-h-[56px]';
const ROW_H_CHILD = 'min-h-[44px]';
const theadRow = 'h-14';
const theadCell =
  'sticky top-0 z-20 border-b border-border bg-muted p-2 font-normal align-bottom shadow-[0_1px_0_0_hsl(var(--border))]';

/** 前四列 sticky 的 left 偏移（累计宽度） */
const FROZEN_LEFT = [
  0,
  FROZEN_COL_WIDTHS[0],
  FROZEN_COL_WIDTHS[0] + FROZEN_COL_WIDTHS[1],
  FROZEN_COL_WIDTHS[0] + FROZEN_COL_WIDTHS[1] + FROZEN_COL_WIDTHS[2],
] as const;

function frozenStyle(colIdx: 0 | 1 | 2 | 3, isHeader: boolean): CSSProperties {
  return {
    position: 'sticky',
    left: FROZEN_LEFT[colIdx],
    width: FROZEN_COL_WIDTHS[colIdx],
    minWidth: FROZEN_COL_WIDTHS[colIdx],
    maxWidth: FROZEN_COL_WIDTHS[colIdx],
    zIndex: isHeader ? 35 - colIdx : 25 - colIdx,
  };
}

function frozenCellClass(colIdx: 0 | 1 | 2 | 3, bg: string, isHeader = false) {
  return cn(
    bg,
    isHeader && colIdx === 3 && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.08)]',
    !isHeader && colIdx === 3 && 'shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]',
  );
}

const METHOD_LABEL: Record<string, string> = {
  by_volume: '按体积',
  by_ticket: '按票',
  fixed: '固定',
  manual: '需确认',
};

function formatContainerBusinessNos(businessNos: string | undefined): string {
  return businessNos?.trim() || '—';
}

function formatFactoryNames(merchants: MerchantRow[]): string {
  const names = merchants
    .map((m) => (m.name?.trim() || m.code).trim())
    .filter(Boolean);
  return names.length ? names.join('、') : '—';
}

function buildContainerHoverTip(
  containerNo: string,
  merchants: MerchantRow[],
  businessNos: string | undefined,
): string {
  return [
    `柜号：${containerNo}`,
    `工厂/主体：${formatFactoryNames(merchants)}`,
    `业务编号：${formatContainerBusinessNos(businessNos)}`,
    `${merchants.length} 个工厂/主体`,
  ].join('\n');
}

function buildContainerSubline(
  merchantCount: number,
  businessNos: string | undefined,
): string {
  const nos = businessNos?.trim();
  if (!nos) return `${merchantCount} 工厂/主体`;
  const truncated = nos.length > 28 ? `${nos.slice(0, 28)}…` : nos;
  return `${merchantCount} 工厂/主体 · 业务编号 ${truncated}`;
}

const BILL_LABEL: Record<string, string> = {
  trucking: '拖车账单',
  freight: '货代账单',
};

function TruncatedTip({
  tip,
  children,
  className,
  align = 'left',
}: {
  tip: string;
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}) {
  if (!tip) {
    return <span className={cn('block max-w-full truncate', className)}>{children}</span>;
  }

  const alignClass =
    align === 'center'
      ? 'left-1/2 -translate-x-1/2 text-center'
      : align === 'right'
        ? 'right-0 text-right'
        : 'left-0 text-left';

  return (
    <span
      className={cn('group/tip relative block max-w-full min-w-0', className)}
      title={tip}
    >
      <span className="block truncate">{children}</span>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full z-[100] mb-1 hidden w-max max-w-[min(400px,90vw)] rounded-md border border-border bg-card px-2 py-1.5 text-xs leading-snug text-text-main shadow-md group-hover/tip:block whitespace-pre-line',
          alignClass,
        )}
      >
        {tip}
      </span>
    </span>
  );
}

function formatColumnTip(col: GlobalColumn) {
  return `费用：${col.feeType}\n分摊：${METHOD_LABEL[col.allocationMethod] ?? col.allocationMethod}\n来源：${BILL_LABEL[col.sourceBillType] ?? col.sourceBillType}`;
}

function resolveFeeAllocationMethod(
  feeType: string,
  sourceBillType: 'trucking' | 'freight',
  feeRules: FeeRule[],
  sourceBillItemId?: string,
  allocationsByBillItem?: Map<string, AllocationItem[]>,
): string {
  const normalized = feeType.trim();
  const active = feeRules
    .filter((r) => r.sourceBillType === sourceBillType)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of active) {
    if (rule.feeType && rule.feeType === normalized) return rule.allocationMethod;
    if (rule.matchPattern && normalized.includes(rule.matchPattern)) return rule.allocationMethod;
  }

  if (sourceBillItemId && allocationsByBillItem) {
    const method = allocationsByBillItem.get(sourceBillItemId)?.[0]?.allocationMethod;
    if (method) return method;
  }

  return 'by_volume';
}

function assignFullAmountForFee(
  feeRows: AllocationItem[],
  targetRowId: string,
  billAmount: number,
  onEditAmount: (id: string, value: string) => void,
) {
  const billStr = String(billAmount);
  for (const row of feeRows) {
    onEditAmount(row.id, row.id === targetRowId ? billStr : '0');
  }
}

function isBalanced(diff: number) {
  return Math.abs(diff) <= 0.01;
}

function formatPercent(ratio: number) {
  if (!ratio) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

function feeColumnKey(feeType: string, sourceBillType: string) {
  return `${sourceBillType}|${feeType}`;
}

function filterChecksByScope<T extends { sourceBillType: 'trucking' | 'freight'; sourceAmountCny: number }>(
  checks: T[],
  scope: MatrixBillScope,
): T[] {
  return checks.filter((c) => c.sourceAmountCny > 0 && c.sourceBillType === scope);
}

function computeScopeTotals(checks: ContainerCheck[]) {
  const billTotal = checks.reduce((sum, c) => sum + c.sourceAmountCny, 0);
  const allocatedTotal = checks.reduce((sum, c) => sum + c.allocatedCny, 0);
  const diffTotal = billTotal - allocatedTotal;
  return {
    billTotal,
    allocatedTotal,
    diffTotal,
    balanced: isBalanced(diffTotal),
  };
}

function getMerchantsWithVolumeForContainer(
  containerNo: string,
  containerStats: ContainerStatRow[],
): MerchantRow[] {
  const rows = containerStats.filter((s) => s.containerNo === containerNo);
  const totalVolume = rows.reduce((sum, s) => sum + Number(s.volumeCbm), 0);
  const map = new Map<string, MerchantRow>();
  for (const s of rows) {
    const volumeCbm = Number(s.volumeCbm);
    const existing = map.get(s.merchantCode);
    if (existing) {
      existing.volumeCbm += volumeCbm;
    } else {
      map.set(s.merchantCode, {
        code: s.merchantCode,
        name: s.merchantName ?? null,
        volumeCbm,
        volumeRatio: 0,
      });
    }
  }
  return [...map.values()]
    .map((m) => ({
      ...m,
      volumeRatio: totalVolume > 0 ? m.volumeCbm / totalVolume : 0,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function buildGlobalColumns(
  preparedGroups: PreparedGroup[],
  priorityMap: Map<string, number>,
  feeRules: FeeRule[],
  allocationsByBillItem: Map<string, AllocationItem[]>,
): GlobalColumn[] {
  const map = new Map<string, GlobalColumn>();
  for (const { scopedChecks } of preparedGroups) {
    for (const c of scopedChecks) {
      const key = feeColumnKey(c.feeType, c.sourceBillType);
      if (!map.has(key)) {
        map.set(key, {
          key,
          feeType: c.feeType,
          sourceBillType: c.sourceBillType,
          allocationMethod: resolveFeeAllocationMethod(
            c.feeType,
            c.sourceBillType,
            feeRules,
            c.sourceBillItemId,
            allocationsByBillItem,
          ),
        });
      }
    }
  }
  const pseudoChecks = [...map.values()].map((col) => ({
    feeType: col.feeType,
    sourceBillType: col.sourceBillType,
  }));
  const sorted = sortFeeChecksByDisplayPriority(pseudoChecks, priorityMap);
  return sorted.map((c) => map.get(feeColumnKey(c.feeType, c.sourceBillType))!);
}

function prepareGroups(
  groups: ContainerFeeGroup[],
  billScope: MatrixBillScope,
  containerStats: ContainerStatRow[],
): PreparedGroup[] {
  return groups
    .map((group) => {
      const scopedChecks = filterChecksByScope(group.checks, billScope);
      if (!scopedChecks.length) return null;
      const checkByKey = new Map<string, ContainerCheck>();
      for (const c of scopedChecks) {
        checkByKey.set(feeColumnKey(c.feeType, c.sourceBillType), c);
      }
      return {
        group,
        scopedChecks,
        scopeTotals: computeScopeTotals(scopedChecks),
        merchants: getMerchantsWithVolumeForContainer(group.containerNo, containerStats),
        checkByKey,
      };
    })
    .filter((g): g is PreparedGroup => g !== null)
    .sort(
      (a, b) =>
        (a.scopeTotals.balanced ? 1 : 0) - (b.scopeTotals.balanced ? 1 : 0) ||
        a.group.containerNo.localeCompare(b.group.containerNo, 'en'),
    );
}

function merchantRowTotal(
  merchantCode: string,
  prepared: PreparedGroup,
  globalColumns: GlobalColumn[],
  allocationsByBillItem: Map<string, AllocationItem[]>,
  editAlloc: Record<string, string>,
): number {
  let sum = 0;
  for (const col of globalColumns) {
    const check = prepared.checkByKey.get(col.key);
    if (!check) continue;
    const cell = (allocationsByBillItem.get(check.sourceBillItemId) ?? []).find(
      (r) => r.merchantCode === merchantCode,
    );
    if (cell) sum += Number(editAlloc[cell.id] ?? cell.allocatedAmountCny) || 0;
  }
  return sum;
}

export function FobContainerMatrixPanel({
  groups,
  containerStats,
  allocations,
  feeRules,
  editAlloc,
  onEditAmount,
  onSaveRow,
  onAssignFullAmount,
  savingRowId,
  readOnly,
  settlementType,
}: {
  groups: ContainerFeeGroup[];
  containerStats: ContainerStatRow[];
  allocations: AllocationItem[];
  feeRules: FeeRule[];
  editAlloc: Record<string, string>;
  onEditAmount: (id: string, value: string) => void;
  onSaveRow: (row: AllocationItem, amount?: string) => void;
  onAssignFullAmount: (
    targetRow: AllocationItem,
    feeRows: AllocationItem[],
    billAmount: number,
  ) => void;
  savingRowId: string | null;
  readOnly: boolean;
  /** 与批次创建时选择的分账类型一致，不可切换 */
  settlementType: MatrixBillScope;
}) {
  const [filter, setFilter] = useState<'issues' | 'all'>('issues');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const priorityMap = useMemo(() => buildFeePriorityMap(feeRules), [feeRules]);
  const allocationsByBillItem = useMemo(() => {
    const map = new Map<string, AllocationItem[]>();
    for (const row of allocations) {
      if (!row.sourceBillItemId) continue;
      const list = map.get(row.sourceBillItemId) ?? [];
      list.push(row);
      map.set(row.sourceBillItemId, list);
    }
    return map;
  }, [allocations]);

  const allPrepared = useMemo(
    () => prepareGroups(groups, settlementType, containerStats),
    [groups, settlementType, containerStats],
  );

  const businessNosByContainer = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of containerStats) {
      const nos = row.businessNos?.trim();
      if (!nos || map.has(row.containerNo)) continue;
      map.set(row.containerNo, nos);
    }
    return map;
  }, [containerStats]);

  const visiblePrepared = useMemo(() => {
    if (filter === 'all') return allPrepared;
    return allPrepared.filter((p) => !p.scopeTotals.balanced);
  }, [allPrepared, filter]);

  const globalColumns = useMemo(
    () => buildGlobalColumns(visiblePrepared, priorityMap, feeRules, allocationsByBillItem),
    [visiblePrepared, priorityMap, feeRules, allocationsByBillItem],
  );

  const issueCount = allPrepared.filter((p) => !p.scopeTotals.balanced).length;
  const scopeLabel = SETTLEMENT_TYPE_LABEL[settlementType];

  const isExpanded = (containerNo: string, defaultOpen: boolean) =>
    expanded[containerNo] ?? defaultOpen;

  const toggleExpanded = (containerNo: string, defaultOpen: boolean) => {
    setExpanded((prev) => ({
      ...prev,
      [containerNo]: !(prev[containerNo] ?? defaultOpen),
    }));
  };

  return (
    <div className="min-w-0 w-full max-w-full space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-primary/30 bg-accent px-3 py-1.5 text-sm font-medium text-primary">
          {scopeLabel}
        </span>
        <span className="mx-1 hidden h-5 w-px bg-border sm:inline" aria-hidden />
        <button
          type="button"
          onClick={() => setFilter('issues')}
          className={cn(
            'rounded-md border px-3 py-1.5 text-sm transition-colors',
            filter === 'issues'
              ? 'border-primary bg-accent text-primary'
              : 'border-border text-text-sub hover:text-text-main',
          )}
        >
          未平账柜 ({issueCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn(
            'rounded-md border px-3 py-1.5 text-sm transition-colors',
            filter === 'all'
              ? 'border-primary bg-accent text-primary'
              : 'border-border text-text-sub hover:text-text-main',
          )}
        >
          全部柜 ({allPrepared.length})
        </button>
      </div>

      {!visiblePrepared.length || !globalColumns.length ? (
        <p className="py-6 text-center text-sm text-text-hint">
          {filter === 'issues'
            ? `${scopeLabel}视图下所有柜均已平账`
            : `${scopeLabel}视图下暂无费用数据`}
        </p>
      ) : (
        <div
          className="w-0 min-w-full max-w-full overflow-auto overscroll-contain rounded-md border border-border max-h-[min(70vh,640px)]"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <table
            className="table-fixed border-separate border-spacing-0 text-sm"
            style={{
              width: FROZEN_TOTAL_WIDTH + globalColumns.length * FEE_COL_WIDTH,
              minWidth: '100%',
            }}
          >
            <colgroup>
              <col style={{ width: FROZEN_COL_WIDTHS[0] }} />
              <col style={{ width: FROZEN_COL_WIDTHS[1] }} />
              <col style={{ width: FROZEN_COL_WIDTHS[2] }} />
              <col style={{ width: FROZEN_COL_WIDTHS[3] }} />
              {globalColumns.map((col) => (
                <col key={col.key} style={{ width: FEE_COL_WIDTH }} />
              ))}
            </colgroup>
            <thead>
              <tr className={cn('text-text-sub', theadRow)}>
                <th
                  className={cn(theadCell, frozenCellClass(0, 'bg-muted', true), 'z-[35] text-left')}
                  style={frozenStyle(0, true)}
                >
                  <div>柜号 / 工厂/主体</div>
                  <div className="mt-0.5 text-[11px] invisible select-none">.</div>
                </th>
                <th
                  className={cn(theadCell, frozenCellClass(1, 'bg-muted', true), 'z-[34] text-right')}
                  style={frozenStyle(1, true)}
                >
                  体积m³
                </th>
                <th
                  className={cn(theadCell, frozenCellClass(2, 'bg-muted', true), 'z-[33] text-right')}
                  style={frozenStyle(2, true)}
                >
                  工厂/主体金额
                </th>
                <th
                  className={cn(theadCell, frozenCellClass(3, 'bg-muted', true), 'z-[32] text-right')}
                  style={frozenStyle(3, true)}
                >
                  本柜账单总额
                </th>
                {globalColumns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(theadCell, feeColClass, 'z-20 text-center')}
                    style={feeColStyle()}
                  >
                    <TruncatedTip tip={formatColumnTip(col)} align="center" className="mx-auto w-full">
                      <span className="block truncate text-xs leading-tight">{col.feeType}</span>
                    </TruncatedTip>
                    <div
                      className={cn(
                        'mx-auto mt-0.5 max-w-full truncate text-[11px]',
                        col.allocationMethod === 'manual'
                          ? 'font-medium text-primary'
                          : 'text-text-hint',
                      )}
                      title={METHOD_LABEL[col.allocationMethod] ?? col.allocationMethod}
                    >
                      {METHOD_LABEL[col.allocationMethod] ?? col.allocationMethod}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePrepared.map((prepared) => {
                const { group, scopeTotals, merchants } = prepared;
                const open = isExpanded(group.containerNo, !scopeTotals.balanced);
                const containerVolume = merchants.reduce((s, m) => s + m.volumeCbm, 0);
                const businessNos = businessNosByContainer.get(group.containerNo);
                const containerHoverTip = buildContainerHoverTip(
                  group.containerNo,
                  merchants,
                  businessNos,
                );
                const containerSubline = buildContainerSubline(merchants.length, businessNos);

                return (
                  <Fragment key={group.containerNo}>
                    <tr className={cn('bg-muted', ROW_H_PARENT)}>
                      <td
                        className={cn(
                          'border-b border-border/60 p-2 align-middle',
                          frozenCellClass(0, 'bg-muted'),
                        )}
                        style={frozenStyle(0, false)}
                      >
                        <button
                          type="button"
                          className="flex w-full min-w-0 items-center gap-1.5 text-left"
                          onClick={() => toggleExpanded(group.containerNo, !scopeTotals.balanced)}
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-text-sub" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-text-sub" />
                          )}
                          {scopeTotals.balanced ? (
                            <CheckCircle2
                              className="h-4 w-4 shrink-0 text-emerald-600"
                              aria-label="已平账"
                            />
                          ) : (
                            <AlertCircle
                              className="h-4 w-4 shrink-0 text-primary"
                              aria-label="未平账"
                            />
                          )}
                          <TruncatedTip
                            tip={containerHoverTip}
                            className="min-w-0 flex-1 font-mono font-semibold text-text-main"
                          >
                            {group.containerNo}
                          </TruncatedTip>
                        </button>
                        <div className="mt-0.5 truncate pl-[2.125rem] text-[11px] text-text-hint">
                          <TruncatedTip tip={containerHoverTip} className="w-full">
                            {containerSubline}
                          </TruncatedTip>
                        </div>
                      </td>
                      <td
                        className={cn(
                          'border-b border-border/60 p-2 text-right align-middle font-numeric text-xs text-text-sub',
                          frozenCellClass(1, 'bg-muted'),
                        )}
                        style={frozenStyle(1, false)}
                      >
                        <TruncatedTip
                          tip={
                            containerVolume > 0 ? `柜总体积 ${containerVolume.toFixed(4)} m³` : ''
                          }
                          align="right"
                        >
                          {containerVolume > 0 ? containerVolume.toFixed(3) : '—'}
                        </TruncatedTip>
                      </td>
                      <td
                        className={cn(
                          'border-b border-border/60 p-2 text-right align-middle font-numeric text-xs',
                          frozenCellClass(2, 'bg-muted'),
                        )}
                        style={frozenStyle(2, false)}
                      >
                        <TruncatedTip tip={`分摊合计 ¥${scopeTotals.allocatedTotal.toFixed(2)}`} align="right">
                          {scopeTotals.allocatedTotal.toFixed(2)}
                        </TruncatedTip>
                      </td>
                      <td
                        className={cn(
                          'border-b border-border/60 p-2 text-right align-middle',
                          frozenCellClass(3, 'bg-muted'),
                        )}
                        style={frozenStyle(3, false)}
                      >
                        <div className="truncate font-numeric text-xs text-text-sub">
                          {scopeTotals.billTotal.toFixed(2)}
                        </div>
                        <div
                          className={cn(
                            'truncate font-numeric text-[11px] font-medium',
                            scopeTotals.balanced ? 'text-emerald-600' : 'text-primary',
                          )}
                        >
                          差 {scopeTotals.diffTotal.toFixed(2)}
                        </div>
                      </td>
                      {globalColumns.map((col) => {
                        const check = prepared.checkByKey.get(col.key);
                        if (!check) {
                          return (
                            <td
                              key={col.key}
                              className={cn(
                                'border-b border-border/60 p-2 text-center align-middle text-text-hint bg-muted',
                                feeColClass,
                              )}
                              style={feeColStyle()}
                            >
                              —
                            </td>
                          );
                        }
                        const colOk = isBalanced(check.diffCny);
                        return (
                          <td
                            key={col.key}
                            className={cn(
                              'border-b border-border/60 p-2 text-center align-middle font-numeric bg-muted',
                              feeColClass,
                            )}
                            style={feeColStyle()}
                          >
                            <div className="text-xs font-medium">
                              {check.sourceAmountCny.toFixed(2)}
                            </div>
                            <div
                              className={cn(
                                'text-[11px]',
                                colOk ? 'text-text-hint' : 'text-primary',
                              )}
                            >
                              摊 {check.allocatedCny.toFixed(0)}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {open &&
                      merchants.map((merchant) => {
                        const rowSum = merchantRowTotal(
                          merchant.code,
                          prepared,
                          globalColumns,
                          allocationsByBillItem,
                          editAlloc,
                        );
                        return (
                          <tr
                            key={`${group.containerNo}-${merchant.code}`}
                            className={cn('bg-card', ROW_H_CHILD)}
                          >
                            <td
                              className={cn(
                                'border-b border-border/40 p-2 pl-8 align-middle',
                                frozenCellClass(0, 'bg-card'),
                              )}
                              style={frozenStyle(0, false)}
                            >
                              <TruncatedTip
                                tip={
                                  merchant.name && merchant.name !== merchant.code
                                    ? `${merchant.name}\n${merchant.code}`
                                    : merchant.code
                                }
                              >
                                <span className="block truncate font-medium text-text-main">
                                  {merchant.name ?? merchant.code}
                                </span>
                              </TruncatedTip>
                              {merchant.name && merchant.name !== merchant.code && (
                                <TruncatedTip
                                  tip={merchant.code}
                                  className="text-xs font-mono text-text-hint"
                                >
                                  {merchant.code}
                                </TruncatedTip>
                              )}
                            </td>
                            <td
                              className={cn(
                                'border-b border-border/40 p-2 text-right align-middle font-numeric',
                                frozenCellClass(1, 'bg-card'),
                              )}
                              style={frozenStyle(1, false)}
                            >
                              <TruncatedTip
                                tip={`${merchant.volumeCbm.toFixed(4)} m³ · ${formatPercent(merchant.volumeRatio)}`}
                                align="right"
                              >
                                <span className="block truncate text-xs">
                                  {merchant.volumeCbm.toFixed(3)}
                                </span>
                              </TruncatedTip>
                              <div className="truncate text-[11px] text-text-hint">
                                {formatPercent(merchant.volumeRatio)}
                              </div>
                            </td>
                            <td
                              className={cn(
                                'border-b border-border/40 p-2 text-right align-middle font-numeric font-medium',
                                frozenCellClass(2, 'bg-card'),
                              )}
                              style={frozenStyle(2, false)}
                            >
                              <TruncatedTip tip={`工厂/主体金额 ¥${rowSum.toFixed(2)}`} align="right">
                                {rowSum.toFixed(2)}
                              </TruncatedTip>
                            </td>
                            <td
                              className={cn(
                                'border-b border-border/40 p-2 text-right align-middle font-numeric text-xs text-text-sub',
                                frozenCellClass(3, 'bg-card'),
                              )}
                              style={frozenStyle(3, false)}
                            >
                              <TruncatedTip
                                tip={`本柜账单总额 ¥${scopeTotals.billTotal.toFixed(2)}`}
                                align="right"
                              >
                                {scopeTotals.billTotal.toFixed(2)}
                              </TruncatedTip>
                            </td>
                            {globalColumns.map((col) => {
                              const check = prepared.checkByKey.get(col.key);
                              if (!check) {
                                return (
                                  <td
                                    key={col.key}
                                    className={cn(
                                      'border-b border-border/40 p-1 text-center align-middle text-text-hint bg-card',
                                      feeColClass,
                                    )}
                                    style={feeColStyle()}
                                  >
                                    —
                                  </td>
                                );
                              }
                              const cell = (
                                allocationsByBillItem.get(check.sourceBillItemId) ?? []
                              ).find((r) => r.merchantCode === merchant.code);
                              const value = cell
                                ? (editAlloc[cell.id] ?? String(cell.allocatedAmountCny))
                                : '';
                              const num = Number(value) || 0;
                              const colOk = isBalanced(check.diffCny);
                              const feeRows =
                                allocationsByBillItem.get(check.sourceBillItemId) ?? [];
                              const isManual = col.allocationMethod === 'manual';
                              const saving = savingRowId === cell?.id;
                              return (
                                <td
                                  key={col.key}
                                  className={cn(
                                    'border-b border-border/40 p-1 text-center align-middle bg-card',
                                    feeColClass,
                                  )}
                                  style={feeColStyle()}
                                >
                                  {cell && !readOnly ? (
                                    <div className="relative mx-auto w-full max-w-[88px]">
                                      <Input
                                        className={cn(
                                          'h-8 w-full font-numeric text-center text-sm',
                                          isManual ? 'pr-7' : '',
                                          !colOk && num === 0 && 'border-amber-300',
                                          saving && 'opacity-60',
                                        )}
                                        value={value}
                                        disabled={saving}
                                        onChange={(e) => onEditAmount(cell.id, e.target.value)}
                                        onBlur={(e) => {
                                          const amount = e.target.value;
                                          if (amount !== String(cell.allocatedAmountCny)) {
                                            onSaveRow(cell, amount);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') e.currentTarget.blur();
                                        }}
                                      />
                                      {isManual && (
                                        <button
                                          type="button"
                                          title="全承担"
                                          aria-label="全承担"
                                          disabled={saving}
                                          className="absolute right-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-primary hover:bg-accent disabled:opacity-40"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => {
                                            assignFullAmountForFee(
                                              feeRows,
                                              cell.id,
                                              check.sourceAmountCny,
                                              onEditAmount,
                                            );
                                            onAssignFullAmount(
                                              cell,
                                              feeRows,
                                              check.sourceAmountCny,
                                            );
                                          }}
                                        >
                                          <CircleCheck
                                            className="h-3.5 w-3.5"
                                            strokeWidth={2.25}
                                          />
                                        </button>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="font-numeric text-text-main">
                                      {cell ? num.toFixed(2) : '—'}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
