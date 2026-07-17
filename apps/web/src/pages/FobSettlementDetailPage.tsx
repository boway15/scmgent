import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDateTimeCst } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { AiBanner } from '@/components/AiBanner';
import { FobBatchStatusBadge, FobExceptionStatusBadge } from '@/components/FobStatusBadge';
import { FobContainerMatrixPanel } from '@/components/FobContainerMatrixPanel';
import { ReconcileDiffDetailDialog } from '@/components/ReconcileDiffDetailDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type FobTemplateType = 'volume' | 'trucking' | 'freight';
type TabKey = 'import' | 'exceptions' | 'reconcile' | 'summary';
type FobDetail = Awaited<ReturnType<typeof api.getFobSettlement>>;

const METHOD_LABEL: Record<string, string> = {
  by_volume: '按体积',
  by_ticket: '按票',
  fixed: '固定',
  manual: '人工识别',
};

const SETTLEMENT_TYPE_LABEL: Record<'trucking' | 'freight', string> = {
  trucking: '拖车分账',
  freight: '货代分账',
};

const PAYMENT_STATUS_OPTIONS = [
  { value: 'paid', label: '是' },
  { value: 'unpaid', label: '否' },
  { value: 'not_required', label: '无需支付' },
] as const;

type PaymentStatus = (typeof PAYMENT_STATUS_OPTIONS)[number]['value'];

function paymentStatusText(status: PaymentStatus | undefined): string {
  return PAYMENT_STATUS_OPTIONS.find((o) => o.value === (status ?? 'unpaid'))?.label ?? '否';
}

function resolvePaymentDraft(
  merchantCode: string,
  server: { paymentStatus?: PaymentStatus; paymentRemark?: string | null },
  paymentStatuses: Record<string, PaymentStatus>,
  paymentRemarks: Record<string, string>,
) {
  return {
    status: paymentStatuses[merchantCode] ?? server.paymentStatus ?? 'unpaid',
    remark: paymentRemarks[merchantCode] ?? server.paymentRemark ?? '',
  };
}

function feeAllocatedTotal(rows: AllocationItem[], sourceBillItemId?: string | null): number {
  if (!sourceBillItemId) return 0;
  return rows
    .filter((r) => r.sourceBillItemId === sourceBillItemId)
    .reduce((sum, r) => sum + Number(r.allocatedAmountCny), 0);
}

const STAGE_LABEL: Record<string, string> = {
  trucking: '拖车',
  freight: '货运',
  customs: '清关',
  other: '其他',
};

type ReconcileViewMode = 'merchant' | 'fee';
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
  manualAdjustCount: number;
};

type MerchantOption = { code: string; name: string | null };
type AllocationItem = FobDetail['allocations'][number];

function getAllocationRuleLabel(row: AllocationItem, allRows: AllocationItem[]): string {
  if (row.isManualOverride) return '人工调整';
  if (row.allocationMethod === 'manual') {
    return feeAllocatedTotal(allRows, row.sourceBillItemId) <= 0 ? '需确认' : '人工识别';
  }
  return METHOD_LABEL[row.allocationMethod] ?? row.allocationMethod;
}

function isRatioRuleActive(row: AllocationItem, kind: 'volume' | 'ticket'): boolean {
  if (row.isManualOverride) return false;
  if (kind === 'volume') return row.allocationMethod === 'by_volume';
  return row.allocationMethod === 'by_ticket';
}

function formatPercent(value: number | string | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

type ContainerStatWithRatio = FobDetail['containerStats'][number] & {
  volumeRatio: number;
  ticketRatio: number;
};

function withContainerRatios(stats: FobDetail['containerStats']): ContainerStatWithRatio[] {
  if (!stats?.length) return [];

  const totalsByContainer = new Map<string, { volume: number; tickets: number }>();
  for (const s of stats) {
    const prev = totalsByContainer.get(s.containerNo) ?? { volume: 0, tickets: 0 };
    totalsByContainer.set(s.containerNo, {
      volume: prev.volume + Number(s.volumeCbm),
      tickets: prev.tickets + Number(s.ticketCount),
    });
  }

  return stats.map((s) => {
    const totals = totalsByContainer.get(s.containerNo) ?? { volume: 0, tickets: 0 };
    return {
      ...s,
      volumeRatio: totals.volume > 0 ? Number(s.volumeCbm) / totals.volume : 0,
      ticketRatio: totals.tickets > 0 ? Number(s.ticketCount) / totals.tickets : 0,
    };
  });
}

function getMerchantOptions(containerStats: FobDetail['containerStats']): MerchantOption[] {
  const map = new Map<string, string | null>();
  for (const s of containerStats ?? []) {
    if (!map.has(s.merchantCode)) map.set(s.merchantCode, s.merchantName ?? null);
  }
  return [...map.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function getMerchantsForContainer(
  containerNo: string,
  containerStats: FobDetail['containerStats'],
): MerchantOption[] {
  const map = new Map<string, string | null>();
  for (const s of containerStats ?? []) {
    if (s.containerNo !== containerNo) continue;
    if (!map.has(s.merchantCode)) map.set(s.merchantCode, s.merchantName ?? null);
  }
  return [...map.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function assignFullAmountToRow(
  rows: AllocationItem[],
  rowId: string,
  billAmount: number,
  onEditAmount: (id: string, value: string) => void,
) {
  for (const row of rows) {
    onEditAmount(row.id, row.id === rowId ? String(billAmount) : '0');
  }
}

function buildContainerBillTotalMap(checks: ContainerCheck[]): Map<string, number> {
  const byItem = new Map<string, { containerNo: string; amount: number }>();
  for (const check of checks) {
    if (!byItem.has(check.sourceBillItemId)) {
      byItem.set(check.sourceBillItemId, {
        containerNo: check.containerNo,
        amount: check.sourceAmountCny,
      });
    }
  }
  const totals = new Map<string, number>();
  for (const { containerNo, amount } of byItem.values()) {
    totals.set(containerNo, (totals.get(containerNo) ?? 0) + amount);
  }
  return totals;
}

function merchantContainerAllocated(
  rows: AllocationItem[],
  merchantCode: string,
  containerNo: string,
): number {
  return rows
    .filter((r) => r.merchantCode === merchantCode && r.containerNo === containerNo)
    .reduce((sum, r) => sum + Number(r.allocatedAmountCny), 0);
}

function isCheckBalanced(check: { diffCny: number }): boolean {
  return Math.abs(check.diffCny) <= 0.01;
}

function buildAllocationsByBillItem(rows: AllocationItem[]): Map<string, AllocationItem[]> {
  const map = new Map<string, AllocationItem[]>();
  for (const row of rows) {
    if (!row.sourceBillItemId) continue;
    const list = map.get(row.sourceBillItemId) ?? [];
    list.push(row);
    map.set(row.sourceBillItemId, list);
  }
  return map;
}

function buildContainerFeeGroups(
  checks: ContainerCheck[],
  allocationsByBillItem: Map<string, AllocationItem[]>,
): ContainerFeeGroup[] {
  const byContainer = new Map<string, ContainerCheck[]>();
  for (const check of checks) {
    const list = byContainer.get(check.containerNo) ?? [];
    list.push(check);
    byContainer.set(check.containerNo, list);
  }

  return [...byContainer.entries()]
    .map(([containerNo, feeChecks]) => {
      const sortedChecks = [...feeChecks].sort(
        (a, b) =>
          (isCheckBalanced(a) ? 1 : 0) - (isCheckBalanced(b) ? 1 : 0) ||
          a.feeType.localeCompare(b.feeType, 'zh-CN'),
      );
      let manualAdjustCount = 0;
      for (const check of sortedChecks) {
        const rows = allocationsByBillItem.get(check.sourceBillItemId) ?? [];
        manualAdjustCount += rows.filter((r) => r.isManualOverride).length;
      }
      const billTotal = sortedChecks.reduce((sum, c) => sum + c.sourceAmountCny, 0);
      const allocatedTotal = sortedChecks.reduce((sum, c) => sum + c.allocatedCny, 0);
      const diffTotal = billTotal - allocatedTotal;
      return {
        containerNo,
        checks: sortedChecks,
        billTotal,
        allocatedTotal,
        diffTotal,
        balanced: Math.abs(diffTotal) <= 0.01,
        manualAdjustCount,
      };
    })
    .sort(
      (a, b) =>
        (a.balanced ? 1 : 0) - (b.balanced ? 1 : 0) ||
        a.containerNo.localeCompare(b.containerNo, 'en'),
    );
}

function ReconcileStatusBadge({ balanced, label }: { balanced: boolean; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded border px-2 py-0.5 text-xs',
        balanced
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      {label ?? (balanced ? '已平' : '待调')}
    </span>
  );
}

function ReconcileViewTabs({
  view,
  onChange,
  merchantCount,
  containerIssueCount,
}: {
  view: ReconcileViewMode;
  onChange: (view: ReconcileViewMode) => void;
  merchantCount: number;
  containerIssueCount: number;
}) {
  const tabs: Array<{ key: ReconcileViewMode; label: string; count?: number }> = [
    { key: 'fee', label: '按柜平账与调账', count: containerIssueCount || undefined },
    { key: 'merchant', label: '按工厂/主体汇总', count: merchantCount || undefined },
  ];

  return (
    <div className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            'relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors',
            view === t.key
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-text-sub hover:text-text-main',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-xs text-text-hint">({t.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}

function buildContainerStatRatioMap(stats: FobDetail['containerStats']): Map<string, { volumeRatio: number; ticketRatio: number }> {
  const map = new Map<string, { volumeRatio: number; ticketRatio: number }>();
  for (const s of withContainerRatios(stats)) {
    map.set(`${s.containerNo}|${s.merchantCode}`, {
      volumeRatio: s.volumeRatio,
      ticketRatio: s.ticketRatio,
    });
  }
  return map;
}

function getAllocationRatios(
  row: AllocationItem,
  statRatios: Map<string, { volumeRatio: number; ticketRatio: number }>,
) {
  const fallback = statRatios.get(`${row.containerNo}|${row.merchantCode}`);
  return {
    volumeRatio: row.volumeRatio ?? fallback?.volumeRatio,
    ticketRatio: row.ticketRatio ?? fallback?.ticketRatio,
  };
}

function sortAllocationRows(rows: AllocationItem[]): AllocationItem[] {
  return [...rows].sort(
    (a, b) =>
      a.containerNo.localeCompare(b.containerNo, 'en') ||
      a.feeType.localeCompare(b.feeType, 'zh-CN') ||
      (a.id ?? '').localeCompare(b.id ?? ''),
  );
}

function AllocationEditList({
  rows,
  merchantOptions,
  editAlloc,
  editMerchant,
  savingRowId,
  onEditAmount,
  onEditMerchant,
  onSave,
  showContainer = false,
  statRatios,
  readOnly = false,
  feeUnbalanced = false,
  compact = false,
  hidePerRowSave = false,
  billAmount,
}: {
  rows: AllocationItem[];
  merchantOptions: MerchantOption[];
  editAlloc: Record<string, string>;
  editMerchant: Record<string, string>;
  savingRowId: string | null;
  onEditAmount: (id: string, value: string) => void;
  onEditMerchant: (id: string, value: string) => void;
  onSave: (row: AllocationItem) => void;
  showContainer?: boolean;
  statRatios?: Map<string, { volumeRatio: number; ticketRatio: number }>;
  readOnly?: boolean;
  feeUnbalanced?: boolean;
  compact?: boolean;
  hidePerRowSave?: boolean;
  billAmount?: number;
}) {
  if (!rows.length) {
    return <p className="py-4 text-center text-sm text-text-hint">暂无分摊明细</p>;
  }

  return (
    <div className="space-y-2">
      {feeUnbalanced && !compact && (
        <p className="text-xs text-amber-800">
          本费用项未平账：已列出本柜全部工厂/主体，未承担方默认为 ¥0，请修改承担金额或承担工厂/主体后保存。
        </p>
      )}
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-text-sub">
            {showContainer && <th className="p-2 font-normal">柜号</th>}
            {!compact && <th className="p-2 font-normal">费用项</th>}
            {!compact && <th className="p-2 font-normal">阶段</th>}
            <th className="p-2 font-normal">规则</th>
            {!compact && (
              <th className="p-2 font-normal" title="该工厂/主体在本柜内的体积份额">
                体积占比
              </th>
            )}
            {!compact && (
              <th className="p-2 font-normal" title="该工厂/主体在本柜内的票数份额（每工厂/主体 1 票）">
                票数占比
              </th>
            )}
            <th className="p-2 font-normal">承担工厂/主体</th>
            <th className="p-2 font-normal">承担金额 (CNY)</th>
            {!hidePerRowSave && <th className="p-2 font-normal">操作</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const currentMerchant = editMerchant[a.id] ?? a.merchantCode;
            const currentAmount = editAlloc[a.id] ?? String(a.allocatedAmountCny);
            const ratios = getAllocationRatios(a, statRatios ?? new Map());
            const dirty =
              currentMerchant !== a.merchantCode || currentAmount !== String(a.allocatedAmountCny);
            const options =
              merchantOptions.some((m) => m.code === a.merchantCode)
                ? merchantOptions
                : [{ code: a.merchantCode, name: null }, ...merchantOptions];

            const isZeroPlaceholder =
              feeUnbalanced && Number(currentAmount) === 0 && !a.isManualOverride;

            return (
              <tr
                key={a.id}
                className={cn(
                  'border-b border-border/40',
                  isZeroPlaceholder && 'bg-muted/30',
                )}
              >
                {showContainer && <td className="p-2 font-mono">{a.containerNo}</td>}
                {!compact && <td className="p-2">{a.feeType}</td>}
                {!compact && <td className="p-2">{STAGE_LABEL[a.stage] ?? a.stage}</td>}
                <td className="p-2">
                  <span
                    className={cn(
                      'inline-flex rounded border px-2 py-0.5 text-xs',
                      a.isManualOverride
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : getAllocationRuleLabel(a, rows) === '需确认'
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : a.allocationMethod === 'manual'
                            ? 'border-violet-200 bg-violet-50 text-violet-800'
                            : 'border-transparent text-text-main',
                    )}
                    title={a.isManualOverride ? a.overrideReason ?? '核算后人工修改' : undefined}
                  >
                    {getAllocationRuleLabel(a, rows)}
                  </span>
                </td>
                {!compact && (
                  <td
                    className={cn(
                      'p-2 font-numeric text-text-sub',
                      isRatioRuleActive(a, 'volume') && 'font-medium text-text-main',
                    )}
                  >
                    {formatPercent(ratios.volumeRatio)}
                  </td>
                )}
                {!compact && (
                  <td
                    className={cn(
                      'p-2 font-numeric text-text-sub',
                      isRatioRuleActive(a, 'ticket') && 'font-medium text-text-main',
                    )}
                  >
                    {formatPercent(ratios.ticketRatio)}
                  </td>
                )}
                <td className="p-2">
                  <select
                    className="h-8 min-w-[140px] rounded-md border border-input bg-card px-2 text-sm disabled:opacity-60"
                    value={currentMerchant}
                    disabled={readOnly}
                    onChange={(e) => onEditMerchant(a.id, e.target.value)}
                  >
                    {options.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name ? `${m.name} (${m.code})` : m.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-2">
                  <div className="flex items-center gap-1">
                    <Input
                      className="h-8 w-28 font-numeric text-sm"
                      value={currentAmount}
                      disabled={readOnly}
                      onChange={(e) => onEditAmount(a.id, e.target.value)}
                    />
                    {billAmount != null && !readOnly && feeUnbalanced && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 px-2 text-xs"
                        title={`填入账单全额 ¥${billAmount.toFixed(2)}`}
                        onClick={() => assignFullAmountToRow(rows, a.id, billAmount, onEditAmount)}
                      >
                        全承担
                      </Button>
                    )}
                  </div>
                </td>
                {!hidePerRowSave && (
                  <td className="p-2">
                    <Button
                      size="sm"
                      variant={dirty ? 'default' : 'outline'}
                      disabled={readOnly || !dirty || savingRowId === a.id}
                      onClick={() => onSave(a)}
                    >
                      {savingRowId === a.id ? '保存中...' : '保存'}
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

type ContainerMatch = NonNullable<FobDetail['containerMatch']>;

function ContainerList({
  title,
  items,
  tone,
  emptyText,
}: {
  title: string;
  items: string[];
  tone: 'ok' | 'warn';
  emptyText: string;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-medium text-text-main">
        {title}
        <span className="ml-2 text-xs font-normal text-text-hint">({items.length})</span>
      </p>
      {items.length ? (
        <ul
          className={cn(
            'max-h-40 space-y-1 overflow-y-auto text-sm font-mono',
            tone === 'ok' ? 'text-emerald-700' : 'text-amber-800',
          )}
        >
          {items.map((c) => (
            <li key={c} className="rounded bg-muted/40 px-2 py-0.5">
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-hint">{emptyText}</p>
      )}
    </div>
  );
}

function ContainerMatchPanel({
  match,
  warnings,
}: {
  match?: ContainerMatch;
  warnings?: string[];
}) {
  if (!match) return null;

  return (
    <Card className={cn(!match.canAllocate && 'border-amber-300')}>
      <CardHeader>
        <CardTitle className="text-base">柜号匹配诊断</CardTitle>
        <p className="text-sm text-text-sub">
          分摊按柜号关联体积与账单。体积 {match.volumeCount} 柜 · 账单 {match.billCount} 柜 · 可分摊{' '}
          <span className={match.matchedCount > 0 ? 'text-emerald-600' : 'text-primary font-medium'}>
            {match.matchedCount}
          </span>{' '}
          柜
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!match.canAllocate && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            体积柜号与账单柜号无交集，无法分摊。请确认三类文件为同一账期，并核对 ED 导出「柜号」与账单「柜号」一致后重新导入。
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ContainerList title="可分摊（两边都有）" items={match.matched} tone="ok" emptyText="无匹配柜号" />
          <ContainerList
            title="仅体积有（账单缺）"
            items={match.volumeOnly}
            tone="warn"
            emptyText="无"
          />
          <ContainerList
            title="仅账单有（体积缺）"
            items={match.billOnly}
            tone="warn"
            emptyText="无"
          />
          <ContainerList
            title="非 FOB（不参与分账）"
            items={match.nonFobOnly}
            tone="warn"
            emptyText="无"
          />
        </div>

        {!!warnings?.length && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-2 text-sm font-medium text-text-main">跳过原因（{warnings.length}）</p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-text-sub">
              {warnings.slice(0, 50).map((w) => (
                <li key={w} className="list-disc ml-4">
                  {w}
                </li>
              ))}
              {warnings.length > 50 && <li className="text-text-hint">…还有 {warnings.length - 50} 条</li>}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ImportedVolumeStatsList({ stats }: { stats: FobDetail['containerStats'] }) {
  const rows = withContainerRatios(stats);
  if (!rows.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">分摊基数（柜 + 工厂/主体）</CardTitle>
        <p className="text-sm text-text-sub">
          各柜内工厂/主体的体积与票数（每工厂/主体 1 票）；占比为柜内份额，供按体积 / 按票规则参考
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-text-sub">
              <th className="p-2 font-normal">柜号</th>
              <th className="p-2 font-normal">业务编号</th>
              <th className="p-2 font-normal">工厂/主体</th>
              <th className="p-2 font-normal">工厂类别</th>
              <th className="p-2 font-normal">SKU</th>
              <th className="p-2 font-normal">体积 (m³)</th>
              <th className="p-2 font-normal">票数</th>
              <th className="p-2 font-normal">体积占比</th>
              <th className="p-2 font-normal">票数占比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-border/40">
                <td className="p-2 font-mono">{s.containerNo}</td>
                <td className="p-2 font-mono text-xs">{s.businessNos || '—'}</td>
                <td className="p-2">
                  {s.merchantName ?? s.merchantCode}
                  {s.merchantName && s.merchantCode !== s.merchantName && (
                    <span className="ml-1 text-xs text-text-hint">({s.merchantCode})</span>
                  )}
                </td>
                <td className="p-2">{s.factoryType || '—'}</td>
                <td className="max-w-[200px] p-2 font-mono text-xs" title={s.skuCodes || undefined}>
                  <span className="line-clamp-2 break-all">{s.skuCodes || '—'}</span>
                </td>
                <td className="p-2 font-numeric">{Number(s.volumeCbm).toFixed(4)}</td>
                <td className="p-2 font-numeric">{s.ticketCount}</td>
                <td className="p-2 font-numeric">{formatPercent(s.volumeRatio)}</td>
                <td className="p-2 font-numeric">{formatPercent(s.ticketRatio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

const WORKFLOW_STEPS = [
  { key: 'import' as TabKey, label: '数据导入' },
  { key: 'exceptions' as TabKey, label: '异常审核' },
  { key: 'reconcile' as TabKey, label: '分摊核算' },
  { key: 'summary' as TabKey, label: '工厂/主体汇总' },
  { key: 'confirm' as const, label: '确认批次' },
];

function getCalculateReadiness(
  imports: ReturnType<typeof getImportReadiness>,
  pendingReview: number,
  containerMatch?: ContainerMatch,
) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const billLabel = imports.settlementType === 'freight' ? '货代账单' : '拖车账单';

  if (!imports.volume) blockers.push('尚未导入体积信息');
  if (!imports.bill) blockers.push(`尚未导入${billLabel}`);
  if (pendingReview > 0) blockers.push(`还有 ${pendingReview} 条异常费用待审核`);
  if (containerMatch && !containerMatch.canAllocate) {
    blockers.push(
      `体积与账单柜号无交集（体积 ${containerMatch.volumeCount} 柜，账单 ${containerMatch.billCount} 柜）`,
    );
  }
  if (containerMatch && containerMatch.billOnly.length > 0) {
    const preview = containerMatch.billOnly.slice(0, 3).join('、');
    const suffix =
      containerMatch.billOnly.length > 3 ? ` 等 ${containerMatch.billOnly.length} 个` : '';
    blockers.push(`账单中有柜号无体积数据（${preview}${suffix}），请补齐体积文件`);
  }

  if (containerMatch?.nonFobOnly.length) {
    const preview = containerMatch.nonFobOnly.slice(0, 3).join('、');
    const suffix =
      containerMatch.nonFobOnly.length > 3 ? ` 等 ${containerMatch.nonFobOnly.length} 个` : '';
    warnings.push(`账单中有非 FOB 柜号（${preview}${suffix}），不参与分账`);
  }

  if (containerMatch?.volumeOnly.length) {
    warnings.push(
      `体积文件中有 ${containerMatch.volumeOnly.length} 个柜号未出现在账单中，不影响核算`,
    );
  }

  return { blockers, warnings, canCalculate: blockers.length === 0 };
}

function getImportReadiness(data: FobDetail) {
  const volume = data.merchantShipments.length > 0 || (data.nonFobContainers?.length ?? 0) > 0;
  const trucking = data.truckingItems.length > 0;
  const freight = data.freightItems.length > 0;
  const bill =
    data.settlementType === 'trucking' ? trucking : freight;
  return {
    volume,
    bill,
    trucking,
    freight,
    settlementType: data.settlementType,
    allReady: volume && bill,
  };
}

function PrerequisiteList({
  imports,
  pendingReview,
  containerMatch,
}: {
  imports: ReturnType<typeof getImportReadiness>;
  pendingReview: number;
  containerMatch?: ContainerMatch;
}) {
  const billLabel = imports.settlementType === 'freight' ? '货代账单' : '拖车账单';
  const billOnlyOk = !containerMatch?.billOnly.length;
  const items = [
    { ok: imports.volume, label: '体积信息已导入' },
    { ok: imports.bill, label: `${billLabel}已导入` },
    {
      ok: billOnlyOk,
      label: billOnlyOk
        ? '账单柜号均有体积数据'
        : `账单有 ${containerMatch?.billOnly.length ?? 0} 个柜号缺少体积`,
    },
    { ok: pendingReview === 0, label: pendingReview > 0 ? `异常费用已处理（剩余 ${pendingReview} 条）` : '异常费用已处理' },
  ];

  return (
    <ul className="space-y-2 text-sm">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          {item.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <Circle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          )}
          <span className={item.ok ? 'text-text-sub' : 'text-amber-800'}>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function getWorkflowState(data: FobDetail) {
  const imports = getImportReadiness(data);
  const pending = data.pendingExceptions ?? 0;
  const calculated = data.status === 'calculated' || data.status === 'confirmed';
  const confirmed = data.status === 'confirmed';

  let currentStep = 1;
  if (!imports.allReady) currentStep = 1;
  else if (pending > 0) currentStep = 2;
  else if (!calculated) currentStep = 3;
  else if (!confirmed) currentStep = 4;
  else currentStep = 5;

  const stepDone = {
    1: imports.allReady,
    2: imports.allReady && pending === 0,
    3: calculated,
    4: data.merchantSummary.length > 0,
    5: confirmed,
  };

  return { currentStep, stepDone, imports, pending, calculated, confirmed };
}

function ImportBlock({
  label,
  hint,
  accept,
  onFile,
  onDownloadTemplate,
  pending,
  templatePending,
  result,
  warnings,
  done,
  stats,
  readOnly = false,
}: {
  label: string;
  hint: string;
  accept: string;
  onFile: (file: File) => void;
  onDownloadTemplate: () => void;
  pending: boolean;
  templatePending?: boolean;
  result?: string;
  warnings?: string[];
  done: boolean;
  stats?: string;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Card className={cn(done && 'border-emerald-200/80')}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start gap-2">
          {done ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <Circle className="mt-0.5 h-5 w-5 shrink-0 text-text-hint" aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="font-medium text-text-main">{label}</div>
            {stats && <p className="text-sm text-text-sub">{stats}</p>}
            <p className="text-xs text-text-hint">{hint}</p>
          </div>
        </div>
        <input
          ref={ref}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || readOnly}
            onClick={() => ref.current?.click()}
          >
            {readOnly ? '已确认只读' : pending ? '导入中...' : done ? '重新导入' : '选择文件'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-primary"
            disabled={templatePending}
            onClick={onDownloadTemplate}
          >
            {templatePending ? '下载中...' : '下载模板'}
          </Button>
        </div>
        {result && <p className="text-xs text-emerald-700">{result}</p>}
        {!!warnings?.length && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">导入提醒（{warnings.length}）</p>
            <ul className="mt-1 list-disc pl-4">
              {warnings.slice(0, 5).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {warnings.length > 5 && <li>…还有 {warnings.length - 5} 条</li>}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkflowStepper({
  currentStep,
  stepDone,
  pendingCount,
  onStepClick,
}: {
  currentStep: number;
  stepDone: Record<number, boolean>;
  pendingCount: number;
  onStepClick: (tab: TabKey) => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <ol className="flex flex-wrap items-center gap-y-3 text-sm">
          {WORKFLOW_STEPS.map((step, index) => {
            const stepNo = index + 1;
            const done = stepDone[stepNo];
            const active = currentStep === stepNo;
            const clickable = step.key !== 'confirm';
            const badge =
              step.key === 'exceptions' && pendingCount > 0 ? (
                <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                  {pendingCount}
                </span>
              ) : null;

            return (
              <li key={step.label} className="flex items-center">
                {index > 0 && <span className="mx-2 hidden text-text-hint sm:inline">→</span>}
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onStepClick(step.key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
                    clickable && 'hover:bg-muted',
                    active && 'bg-accent text-primary font-medium',
                    !clickable && 'cursor-default text-text-sub',
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                  ) : (
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium',
                        active ? 'bg-primary text-primary-foreground' : 'border border-border text-text-hint',
                      )}
                    >
                      {stepNo}
                    </span>
                  )}
                  <span>{step.label}</span>
                  {badge}
                </button>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

export function FobSettlementDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('import');
  const [importMsg, setImportMsg] = useState<Record<string, string>>({});
  const [importWarnings, setImportWarnings] = useState<Record<string, string[]>>({});
  const [paymentRemarks, setPaymentRemarks] = useState<Record<string, string>>({});
  const [paymentStatuses, setPaymentStatuses] = useState<Record<string, PaymentStatus>>({});
  const [paymentError, setPaymentError] = useState('');
  const [templateLoading, setTemplateLoading] = useState<FobTemplateType | null>(null);
  const [editAlloc, setEditAlloc] = useState<Record<string, string>>({});
  const [editMerchant, setEditMerchant] = useState<Record<string, string>>({});
  const [reconcileView, setReconcileView] = useState<ReconcileViewMode>('fee');
  const [diffDetailOpen, setDiffDetailOpen] = useState(false);
  const [exporting, setExporting] = useState<'total' | 'merchant' | null>(null);
  const [exportError, setExportError] = useState('');
  const [calculateConfirmOpen, setCalculateConfirmOpen] = useState(false);
  const [calculateConfirmWarnings, setCalculateConfirmWarnings] = useState<string[]>([]);
  const [expandedMerchant, setExpandedMerchant] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [exceptionError, setExceptionError] = useState('');

  const downloadTemplate = async (type: FobTemplateType) => {
    setTemplateLoading(type);
    try {
      await api.downloadFobTemplate(type);
    } finally {
      setTemplateLoading(null);
    }
  };

  const downloadReconcileExport = async (kind: 'total' | 'merchant') => {
    if (!id) return;
    setExporting(kind);
    setExportError('');
    try {
      if (kind === 'total') {
        await api.downloadFobReconcileTotal(id);
      } else {
        await api.downloadFobReconcileByMerchant(id);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(null);
    }
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['fob-settlement', id],
    queryFn: () => api.getFobSettlement(id),
    enabled: !!id,
  });

  const { data: exceptions } = useQuery({
    queryKey: ['fob-exceptions', id],
    queryFn: () => api.getFobExceptions(id),
    enabled: !!id && tab === 'exceptions',
  });

  const { data: reconcile, refetch: refetchReconcile } = useQuery({
    queryKey: ['fob-reconcile', id],
    queryFn: () => api.getFobReconcile(id),
    enabled: !!id && (tab === 'reconcile' || tab === 'summary'),
  });

  const { data: feeRules = [] } = useQuery({
    queryKey: ['fob-fee-rules'],
    queryFn: () => api.getFobFeeRules(),
    enabled: !!id && tab === 'reconcile',
  });

  const importTrucking = useMutation({
    mutationFn: (file: File) => api.importFobTrucking(id, file),
    onSuccess: (r) => {
      setImportMsg((m) => ({
        ...m,
        trucking: `本次导入 ${r.imported} 条、${r.containers} 柜，跳过 ${r.skippedRows} 行`,
      }));
      setImportWarnings((m) => ({ ...m, trucking: r.warnings ?? [] }));
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
    },
  });

  const importFreight = useMutation({
    mutationFn: (file: File) => api.importFobFreight(id, file),
    onSuccess: (r) => {
      setImportMsg((m) => ({
        ...m,
        freight: `本次导入 ${r.imported} 条、${r.containers} 柜`,
      }));
      setImportWarnings((m) => ({ ...m, freight: r.warnings ?? [] }));
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
    },
  });

  const importShipments = useMutation({
    mutationFn: (file: File) => api.importFobShipments(id, file),
    onSuccess: (r) => {
      setImportMsg((m) => ({
        ...m,
        shipments: `本次导入 ${r.imported} 条、${r.containers} 柜、${r.merchants ?? '—'} 个工厂/主体，跳过 ${r.skippedRows ?? 0} 行`,
      }));
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
    },
  });

  const [calcError, setCalcError] = useState('');
  const [calcWarnings, setCalcWarnings] = useState<string[]>([]);

  const calculate = useMutation({
    mutationFn: () => api.calculateFobSettlement(id),
    onSuccess: (r) => {
      setCalcError('');
      setCalcWarnings(r.warnings ?? []);
      setImportMsg((m) => ({
        ...m,
        calc: `已生成 ${r.allocationCount} 条分摊；差额 ${r.reconcile.diffCny.toFixed(2)} 元`,
      }));
      setTab('reconcile');
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
      refetchReconcile();
    },
    onError: (err: Error & { warnings?: string[] }) => {
      setCalcError(err.message);
      setCalcWarnings(err.warnings ?? []);
    },
  });

  const markReviewed = useMutation({
    mutationFn: () => api.updateFobSettlement(id, { status: 'reviewed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fob-settlement', id] }),
  });

  const confirmException = useMutation({
    mutationFn: (item: {
      id: string;
      billType: 'trucking' | 'freight';
      assignedMerchantCode?: string;
      adjustedAmountCny?: number;
      allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
    }) =>
      api.patchFobException(id, item.id, {
        billType: item.billType,
        exceptionStatus: 'confirmed',
        assignedMerchantCode: item.assignedMerchantCode,
        adjustedAmountCny: item.adjustedAmountCny,
        allocationMethod: item.allocationMethod,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-exceptions', id] });
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
    },
  });

  const adjustAllocation = useMutation({
    mutationFn: (payload: { allocationId: string; adjustType: 'amount' | 'merchant'; value: string }) =>
      api.postFobAdjustment(id, {
        allocationId: payload.allocationId,
        adjustType: payload.adjustType,
        adjustedValue: payload.value,
        reason: payload.adjustType === 'merchant' ? '人工调整承担工厂/主体' : '人工调账',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
      refetchReconcile();
    },
  });

  const saveAllocationRow = async (row: AllocationItem, amountOverride?: string) => {
    const nextMerchant = editMerchant[row.id] ?? row.merchantCode;
    const nextAmount = amountOverride ?? editAlloc[row.id] ?? String(row.allocatedAmountCny);
    setSavingRowId(row.id);
    try {
      if (nextMerchant !== row.merchantCode) {
        await adjustAllocation.mutateAsync({
          allocationId: row.id,
          adjustType: 'merchant',
          value: nextMerchant,
        });
      }
      if (nextAmount !== String(row.allocatedAmountCny)) {
        await adjustAllocation.mutateAsync({
          allocationId: row.id,
          adjustType: 'amount',
          value: nextAmount,
        });
        setEditAlloc((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      }
    } finally {
      setSavingRowId(null);
    }
  };

  const assignFullFeeAmount = async (
    targetRow: AllocationItem,
    feeRows: AllocationItem[],
    billAmount: number,
  ) => {
    const billStr = String(billAmount);
    setSavingRowId(targetRow.id);
    try {
      for (const row of feeRows) {
        const next = row.id === targetRow.id ? billStr : '0';
        if (next === String(row.allocatedAmountCny)) continue;
        await adjustAllocation.mutateAsync({
          allocationId: row.id,
          adjustType: 'amount',
          value: next,
        });
        setEditAlloc((prev) => {
          const nextState = { ...prev };
          delete nextState[row.id];
          return nextState;
        });
      }
    } finally {
      setSavingRowId(null);
    }
  };

  const updateBatch = useMutation({
    mutationFn: () => api.updateFobSettlement(id, { status: 'confirmed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fob-settlement', id] }),
  });

  const patchPayment = useMutation({
    mutationFn: (payload: {
      merchantCode: string;
      paymentStatus: 'paid' | 'unpaid' | 'not_required';
      remark?: string;
    }) =>
      api.patchFobMerchantPayments(id, {
        updates: [
          {
            merchantCode: payload.merchantCode,
            paymentStatus: payload.paymentStatus,
            remark: payload.remark,
          },
        ],
      }),
    onSuccess: (_data, variables) => {
      setPaymentError('');
      setPaymentStatuses((prev) => {
        const next = { ...prev };
        delete next[variables.merchantCode];
        return next;
      });
      setPaymentRemarks((prev) => {
        const next = { ...prev };
        delete next[variables.merchantCode];
        return next;
      });
      qc.invalidateQueries({ queryKey: ['fob-settlement', id] });
    },
    onError: (e: Error) => setPaymentError(e.message),
  });

  const handlePaymentStatusChange = (
    merchantCode: string,
    paymentStatus: PaymentStatus,
    remark: string,
  ) => {
    setPaymentStatuses((prev) => ({ ...prev, [merchantCode]: paymentStatus }));
    if (paymentStatus === 'not_required' && !remark.trim()) {
      setPaymentError('');
      return;
    }
    setPaymentError('');
    patchPayment.mutate({
      merchantCode,
      paymentStatus,
      remark: remark.trim() || undefined,
    });
  };

  const handlePaymentRemarkBlur = (
    merchantCode: string,
    server: { paymentStatus?: PaymentStatus; paymentRemark?: string | null },
    remark: string,
  ) => {
    const status =
      paymentStatuses[merchantCode] ?? server.paymentStatus ?? 'unpaid';
    if (status === 'not_required' && !remark.trim()) {
      setPaymentError('选择「无需支付」时备注必填');
      return;
    }
    const savedStatus = server.paymentStatus ?? 'unpaid';
    const savedRemark = server.paymentRemark ?? '';
    if (status === savedStatus && remark.trim() === savedRemark) return;
    setPaymentError('');
    patchPayment.mutate({
      merchantCode,
      paymentStatus: status,
      remark: remark.trim() || undefined,
    });
  };

  const handleCalculate = () => {
    if (!data) return;
    const imports = getImportReadiness(data);
    const pending = exceptions?.pendingCount ?? data.pendingExceptions ?? 0;
    const readiness = getCalculateReadiness(imports, pending, data.containerMatch);

    if (!readiness.canCalculate) return;

    if (readiness.warnings.length > 0) {
      setCalculateConfirmWarnings(readiness.warnings);
      setCalculateConfirmOpen(true);
      return;
    }

    calculate.mutate();
  };

  const sortedAllocations = useMemo(
    () => sortAllocationRows(data?.allocations ?? []),
    [data?.allocations],
  );

  const containerBillTotals = useMemo(
    () => buildContainerBillTotalMap(reconcile?.containerChecks ?? []),
    [reconcile?.containerChecks],
  );

  if (isLoading) return <p className="text-text-sub">加载中...</p>;
  if (isError || !data) {
    return (
      <p className="text-destructive">
        加载失败：{error instanceof Error ? error.message : '请稍后重试'}
      </p>
    );
  }

  const workflow = getWorkflowState(data);
  const pendingReview = exceptions?.pendingCount ?? data.pendingExceptions ?? 0;
  const calculateReadiness = getCalculateReadiness(
    workflow.imports,
    pendingReview,
    data.containerMatch,
  );
  const displayMatch = data.containerMatch;
  const displayWarnings = calcWarnings.length ? calcWarnings : undefined;
  const merchantCount = new Set(data.containerStats?.map((s) => s.merchantCode) ?? []).size;
  const merchantOptions = getMerchantOptions(data.containerStats);
  const containerStatRatios = buildContainerStatRatioMap(data.containerStats);
  const containerIssueCount =
    reconcile?.containerChecks.filter((c) => Math.abs(c.diffCny) > 0.01).length ?? 0;

  const tabs: Array<{ key: TabKey; label: string; badge?: number }> = [
    { key: 'import', label: '数据导入' },
    { key: 'exceptions', label: '异常审核', badge: pendingReview || undefined },
    { key: 'reconcile', label: '分摊平账' },
    { key: 'summary', label: '工厂/主体汇总' },
  ];

  const missingImports = [
    !workflow.imports.volume && '体积信息',
    !workflow.imports.bill &&
      (data.settlementType === 'trucking' ? '拖车账单' : '货代账单'),
  ].filter(Boolean) as string[];

  const billLabel = data.settlementType === 'trucking' ? '拖车账单' : '货代账单';
  const billStats =
    data.settlementType === 'trucking'
      ? workflow.imports.trucking
        ? `${data.truckingItems.length} 条费用`
        : undefined
      : workflow.imports.freight
        ? `${data.freightItems.length} 条费用`
        : undefined;
  const volumeStats = workflow.imports.volume
    ? `${data.merchantShipments.length} 行明细 · ${data.containerStats?.length ?? 0} 柜+工厂/主体 · ${merchantCount} 个工厂/主体`
    : undefined;
  const billDone = workflow.imports.bill;
  const isReadOnly = workflow.confirmed;
  const canConfirmBatch =
    workflow.calculated &&
    !isReadOnly &&
    pendingReview === 0 &&
    reconcile?.balanced === true;

  return (
    <div className="min-w-0 max-w-full space-y-6">
      <PageHeader title={data.name}>
        <Link to="/logistics/fob-settlement" className="text-sm text-primary hover:underline">
          返回列表
        </Link>
      </PageHeader>

      {isReadOnly && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          本批次已确认，数据只读，不可再导入、核算或调账。
        </div>
      )}

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <p className="text-xs text-text-hint">批次编号</p>
            <p className="font-mono text-sm text-text-main">{data.batchNo}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-text-hint">账期</p>
            <p className="text-sm text-text-main">{data.settlementPeriod}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-text-hint">分账类型</p>
            <p className="text-sm text-text-main">{SETTLEMENT_TYPE_LABEL[data.settlementType]}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-text-hint">服务商</p>
            <p className="text-sm text-text-main">{data.serviceProvider?.name ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-text-hint">创建人</p>
            <p className="text-sm text-text-main">{data.createdByName ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-text-hint">创建时间</p>
            <p className="text-sm text-text-main">{formatDateTimeCst(data.createdAt)}</p>
          </div>
          <div className="space-y-1 lg:col-span-6">
            <p className="text-xs text-text-hint">批次状态</p>
            <FobBatchStatusBadge status={data.status} />
          </div>
        </CardContent>
      </Card>

      <WorkflowStepper
        currentStep={workflow.currentStep}
        stepDone={workflow.stepDone}
        pendingCount={pendingReview}
        onStepClick={setTab}
      />

      <nav className="flex gap-1 border-b border-border" aria-label="FOB 分账步骤">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors',
              tab === t.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-text-sub hover:text-text-main',
            )}
          >
            {t.label}
            {t.badge ? (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {tab === 'import' && (
        <div className="space-y-4">
          <div className={cn('grid gap-4', data.settlementType === 'trucking' ? 'md:grid-cols-2' : 'md:grid-cols-2')}>
            <ImportBlock
              label="1. 体积信息"
              hint="支持截单清单导出（含工厂名称/类型）、汇总模板或 ED 大件调拨表；截单清单以工厂名称为分账主体，有货柜号时优先用正式柜号，按柜+工厂/主体汇总体积"
              accept=".csv,.xlsx,.xls"
              pending={importShipments.isPending}
              templatePending={templateLoading === 'volume'}
              result={importMsg.shipments}
              done={workflow.imports.volume}
              stats={volumeStats}
              readOnly={isReadOnly}
              onFile={(f) => importShipments.mutate(f)}
              onDownloadTemplate={() => downloadTemplate('volume')}
            />
            {data.settlementType === 'trucking' ? (
              <ImportBlock
                label="2. 拖车账单"
                hint="按模板宽表填写（货柜号+费用列），亦支持拖车行原表导入"
                accept=".xlsx,.xls"
                pending={importTrucking.isPending}
                templatePending={templateLoading === 'trucking'}
                result={importMsg.trucking}
                warnings={importWarnings.trucking}
                done={billDone}
                stats={billStats}
                readOnly={isReadOnly}
                onFile={(f) => importTrucking.mutate(f)}
                onDownloadTemplate={() => downloadTemplate('trucking')}
              />
            ) : (
              <ImportBlock
                label="2. 货代账单"
                hint="按模板宽表填写港杂费（金额均为人民币），亦支持货代对账单原表"
                accept=".xlsx,.xls"
                pending={importFreight.isPending}
                templatePending={templateLoading === 'freight'}
                result={importMsg.freight}
                warnings={importWarnings.freight}
                done={billDone}
                stats={billStats}
                readOnly={isReadOnly}
                onFile={(f) => importFreight.mutate(f)}
                onDownloadTemplate={() => downloadTemplate('freight')}
              />
            )}
          </div>

          {missingImports.length > 0 && (
            <AiBanner message={`请先导入：${missingImports.join('、')}`} />
          )}

          {workflow.imports.allReady && pendingReview > 0 && (
            <AiBanner
              message={`有 ${pendingReview} 条异常费用待审核，处理完成后才能核算`}
              onFix={() => setTab('exceptions')}
              fixLabel="去异常审核"
            />
          )}

          {workflow.imports.allReady && pendingReview === 0 && !workflow.calculated && (
            <AiBanner
              message={`体积与${billLabel}已就绪，可执行分摊核算`}
              onFix={() => setTab('reconcile')}
              fixLabel="去分摊核算"
            />
          )}
        </div>
      )}

      {tab === 'exceptions' && (
        <div className="space-y-4">
          {pendingReview === 0 && workflow.imports.allReady && (
            <AiBanner
              message="异常费用已全部处理，可进入分摊核算"
              onFix={() => setTab('reconcile')}
              fixLabel="去分摊核算"
            />
          )}

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">异常费用审核</CardTitle>
                <p className="mt-1 text-sm text-text-sub">
                  仅拦截未在费用规则中配置的费用项（如茶水费）及备注/金额异常。已配置为「需确认」的分摊方式（如改单费、其他）请在分摊平账时指定承担工厂/主体。
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isReadOnly || markReviewed.isPending || pendingReview > 0}
                  onClick={() => markReviewed.mutate()}
                >
                  标记已审核
                </Button>
                {pendingReview > 0 && (
                  <p className="text-xs text-text-hint">还有 {pendingReview} 条待确认</p>
                )}
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {exceptionError && (
                <p className="mb-3 text-sm text-red-600">{exceptionError}</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-text-sub">
                    <th className="p-2 font-normal">来源</th>
                    <th className="p-2 font-normal">柜号</th>
                    <th className="p-2 font-normal">费用项</th>
                    <th className="p-2 font-normal">异常原因</th>
                    <th className="p-2 font-normal">分摊方式</th>
                    <th className="p-2 font-normal">金额 (CNY)</th>
                    <th className="p-2 font-normal">归属工厂/主体</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(exceptions?.items ?? []).map((item) => (
                    <tr key={item.id} className="border-b border-border/40">
                      <td className="p-2">{item.billType === 'trucking' ? '拖车' : '货代'}</td>
                      <td className="p-2 font-mono">{item.containerNo}</td>
                      <td className="p-2">{item.feeType}</td>
                      <td className="p-2 text-xs text-amber-800">
                        {item.exceptionReasonLabel ?? '—'}
                      </td>
                      <td className="p-2">
                        <select
                          className="h-8 min-w-[110px] rounded-md border border-input bg-card px-2 text-sm disabled:opacity-60"
                          defaultValue={item.allocationMethod ?? 'by_volume'}
                          id={`method-${item.id}`}
                          disabled={isReadOnly}
                        >
                          <option value="by_volume">按体积</option>
                          <option value="by_ticket">按票</option>
                          <option value="fixed">固定</option>
                          <option value="manual">需确认</option>
                        </select>
                      </td>
                      <td className="p-2 font-numeric">{item.adjustedAmountCny.toFixed(2)}</td>
                      <td className="p-2">
                        <Input
                          className="h-8 text-sm"
                          defaultValue={item.assignedMerchantCode ?? ''}
                          id={`merchant-${item.id}`}
                          placeholder="固定/需确认时填写"
                          disabled={isReadOnly}
                        />
                      </td>
                      <td className="p-2">
                        <FobExceptionStatusBadge status={item.exceptionStatus ?? 'pending'} />
                      </td>
                      <td className="p-2">
                        {item.exceptionStatus === 'pending' && !isReadOnly && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={confirmException.isPending}
                            onClick={() => {
                              const methodEl = document.getElementById(`method-${item.id}`) as HTMLSelectElement | null;
                              const merchantEl = document.getElementById(`merchant-${item.id}`) as HTMLInputElement | null;
                              const allocationMethod = (methodEl?.value ?? 'by_volume') as
                                | 'by_volume'
                                | 'by_ticket'
                                | 'fixed'
                                | 'manual';
                              const merchant = merchantEl?.value.trim();
                              if ((allocationMethod === 'manual' || allocationMethod === 'fixed') && !merchant) {
                                setExceptionError('固定分摊或需确认须填写归属工厂/主体');
                                return;
                              }
                              setExceptionError('');
                              confirmException.mutate({
                                id: item.id,
                                billType: item.billType,
                                allocationMethod,
                                assignedMerchantCode: merchant || undefined,
                                adjustedAmountCny: item.adjustedAmountCny,
                              });
                            }}
                          >
                            确认
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!exceptions?.items.length && (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-text-hint">
                        无未配置或异常费用行，可直接进入分摊核算
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'reconcile' && (
        <div className="min-w-0 space-y-4">
          <Card className="border-primary/20 bg-accent/30">
            <CardHeader>
              <CardTitle className="text-base">执行分摊核算</CardTitle>
              <p className="text-sm text-text-sub">
                分摊方式见{' '}
                <Link to="/logistics/fob-settlement?tab=rules" className="text-primary hover:underline">
                  费用规则配置
                </Link>
                ；规则为「需确认」的费用各工厂/主体默认 ¥0，请在下方平账时指定承担方；调账后标记为人工调整
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium text-text-main">核算前置条件</p>
                  <PrerequisiteList
                    imports={workflow.imports}
                    pendingReview={pendingReview}
                    containerMatch={displayMatch}
                  />
                </div>
                <div className="flex flex-col justify-center gap-3">
                  {!workflow.calculated ? (
                    <>
                      <Button
                        size="lg"
                        className="w-full sm:w-auto"
                        onClick={handleCalculate}
                        disabled={isReadOnly || calculate.isPending || !calculateReadiness.canCalculate}
                      >
                        {calculate.isPending ? '核算中...' : '执行分摊核算'}
                      </Button>
                      {!calculateReadiness.canCalculate && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          <p className="font-medium">暂不可核算，请先完成：</p>
                          <ul className="mt-1 list-disc pl-4">
                            {calculateReadiness.blockers.map((b) => (
                              <li key={b}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-emerald-700">
                        {importMsg.calc || '分摊核算已完成，可查看平账结果与工厂/主体汇总'}
                      </p>
                      <Button
                        size="lg"
                        className="w-full sm:w-auto"
                        onClick={() => updateBatch.mutate()}
                        disabled={updateBatch.isPending || !canConfirmBatch}
                      >
                        {updateBatch.isPending ? '确认中...' : '确认批次'}
                      </Button>
                      {!canConfirmBatch && !isReadOnly && (
                        <p className="text-xs text-amber-800">
                          {pendingReview > 0
                            ? '仍有异常待审核，无法确认'
                            : reconcile && !reconcile.balanced
                              ? '未平账，请先调整分摊明细'
                              : '请先完成分摊核算'}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={handleCalculate}
                        disabled={isReadOnly || calculate.isPending || !calculateReadiness.canCalculate}
                      >
                        重新核算
                      </Button>
                    </>
                  )}
                  {calcError && <p className="text-sm text-red-600">{calcError}</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          {workflow.imports.allReady && (
            <>
              <ContainerMatchPanel match={displayMatch} warnings={displayWarnings} />
              <ImportedVolumeStatsList stats={data.containerStats} />
            </>
          )}

          {pendingReview > 0 && (
            <AiBanner
              message={`仍有 ${pendingReview} 条异常待审核，请先处理`}
              onFix={() => setTab('exceptions')}
              fixLabel="去异常审核"
            />
          )}

          {reconcile && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-text-sub">账单总额</p>
                    <p className="mt-1 text-2xl font-semibold font-numeric text-text-main">
                      ¥{reconcile.billTotalCny.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-text-sub">分摊总额</p>
                    <p className="mt-1 text-2xl font-semibold font-numeric text-text-main">
                      ¥{reconcile.allocationTotalCny.toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
                <Card className={cn(!reconcile.balanced && 'border-primary/40')}>
                  <CardContent className="pt-6">
                    <p className="text-sm text-text-sub">差额</p>
                    <p
                      className={cn(
                        'mt-1 text-2xl font-semibold font-numeric',
                        reconcile.balanced ? 'text-emerald-600' : 'text-primary',
                      )}
                    >
                      ¥{reconcile.diffCny.toFixed(2)}
                    </p>
                    <p className="mt-1 text-xs text-text-hint">
                      {reconcile.balanced ? '已平账，可确认批次' : '未平账，请在下方调整承担工厂/主体或金额'}
                    </p>
                    {!!reconcile.warnings.length && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="mt-3 h-8 text-xs"
                        onClick={() => setDiffDetailOpen(true)}
                      >
                        查看差额详情（{reconcile.warnings.length} 项）
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>

              <ReconcileDiffDetailDialog
                open={diffDetailOpen}
                onOpenChange={setDiffDetailOpen}
                warnings={reconcile.warnings}
                diffCny={reconcile.diffCny}
              />
            </>
          )}

          {!!sortedAllocations.length && (
            <Card className="min-w-0 max-w-full">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base">平账结果</CardTitle>
                  <p className="text-sm text-text-sub">
                    按柜查看账单总额、分摊总额与差额；展开费用项可直接调账。切换「按工厂/主体汇总」可从工厂/主体视角核对承担金额
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!exporting}
                    onClick={() => downloadReconcileExport('total')}
                  >
                    {exporting === 'total' ? '导出中...' : '导出总账'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!exporting}
                    onClick={() => downloadReconcileExport('merchant')}
                  >
                    {exporting === 'merchant' ? '打包中...' : '按工厂/主体导出'}
                  </Button>
                </div>
                {exportError && <p className="w-full text-sm text-red-600">{exportError}</p>}
              </CardHeader>
              <CardContent className="min-w-0 max-w-full space-y-4">
                {paymentError && <p className="text-sm text-red-600">{paymentError}</p>}
                <ReconcileViewTabs
                  view={reconcileView}
                  onChange={setReconcileView}
                  merchantCount={data.merchantSummary.length}
                  containerIssueCount={containerIssueCount}
                />

                {reconcileView === 'merchant' && (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {data.merchantSummary.map((s) => {
                      const expanded = expandedMerchant === s.merchantCode;
                      const rows = sortedAllocations.filter((a) => a.merchantCode === s.merchantCode);
                      const containerCount = new Set(rows.map((r) => r.containerNo)).size;
                      const { status, remark: remarkValue } = resolvePaymentDraft(
                        s.merchantCode,
                        s,
                        paymentStatuses,
                        paymentRemarks,
                      );
                      const pendingNotRequired =
                        status === 'not_required' && !remarkValue.trim();
                      return (
                        <li key={s.merchantCode}>
                          <button
                            type="button"
                            className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
                            onClick={() =>
                              setExpandedMerchant(expanded ? null : s.merchantCode)
                            }
                          >
                            <div>
                              <p className="font-medium text-text-main">
                                {s.merchantName ?? s.merchantCode}
                              </p>
                              <p className="text-xs text-text-hint font-mono">
                                {s.merchantCode}
                                {containerCount > 0 && ` · ${containerCount} 柜`}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-sm">
                              <span className="text-text-sub">
                                拖车 {s.truckingTotal.toFixed(2)} · 货运 {s.freightTotal.toFixed(2)} · 清关{' '}
                                {s.customsTotal.toFixed(2)}
                                {s.otherTotal > 0 ? ` · 其他 ${s.otherTotal.toFixed(2)}` : ''}
                              </span>
                              <span className="font-semibold font-numeric text-primary">
                                合计 ¥{s.grandTotal.toFixed(2)}
                              </span>
                              <span className="rounded border border-border px-2 py-0.5 text-xs text-text-sub">
                                付款：{paymentStatusText(status)}
                              </span>
                              <span className="text-xs text-text-hint">{expanded ? '收起 ▲' : '展开明细 ▼'}</span>
                            </div>
                          </button>
                          {expanded && (
                            <div className="border-t border-border bg-muted/30 px-4 py-3 space-y-3">
                              <div className="flex flex-wrap items-end gap-4">
                                <label className="space-y-1 text-sm">
                                  <span className="text-text-sub">是否付款</span>
                                  <select
                                    className="block h-8 min-w-[120px] rounded-md border border-input bg-card px-2 text-sm"
                                    value={status}
                                    disabled={patchPayment.isPending}
                                    onChange={(e) =>
                                      handlePaymentStatusChange(
                                        s.merchantCode,
                                        e.target.value as PaymentStatus,
                                        remarkValue,
                                      )
                                    }
                                  >
                                    {PAYMENT_STATUS_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="min-w-[200px] flex-1 space-y-1 text-sm">
                                  <span className="text-text-sub">备注</span>
                                  <Input
                                    className="h-8 text-sm"
                                    placeholder={status === 'not_required' ? '必填' : '可选'}
                                    value={remarkValue}
                                    disabled={patchPayment.isPending}
                                    onChange={(e) =>
                                      setPaymentRemarks((prev) => ({
                                        ...prev,
                                        [s.merchantCode]: e.target.value,
                                      }))
                                    }
                                    onBlur={(e) =>
                                      handlePaymentRemarkBlur(
                                        s.merchantCode,
                                        s,
                                        e.target.value,
                                      )
                                    }
                                  />
                                  {pendingNotRequired && (
                                    <p className="text-xs text-text-hint">填写备注后自动保存</p>
                                  )}
                                </label>
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b text-left text-text-sub">
                                    <th className="p-2 font-normal">柜号</th>
                                    <th className="p-2 font-normal">工厂/主体金额</th>
                                    <th className="p-2 font-normal">本柜账单总额</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...new Set(rows.map((r) => r.containerNo))]
                                    .sort((a, b) => a.localeCompare(b, 'en'))
                                    .map((containerNo) => (
                                      <tr key={containerNo} className="border-b border-border/40">
                                        <td className="p-2 font-mono">{containerNo}</td>
                                        <td className="p-2 font-numeric">
                                          {merchantContainerAllocated(
                                            rows,
                                            s.merchantCode,
                                            containerNo,
                                          ).toFixed(2)}
                                        </td>
                                        <td className="p-2 font-numeric">
                                          {(containerBillTotals.get(containerNo) ?? 0).toFixed(2)}
                                        </td>
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                              <AllocationEditList
                                rows={rows}
                                merchantOptions={merchantOptions}
                                statRatios={containerStatRatios}
                                showContainer
                                readOnly={isReadOnly}
                                editAlloc={editAlloc}
                                editMerchant={editMerchant}
                                savingRowId={savingRowId}
                                onEditAmount={(id, value) =>
                                  setEditAlloc((prev) => ({ ...prev, [id]: value }))
                                }
                                onEditMerchant={(id, value) =>
                                  setEditMerchant((prev) => ({ ...prev, [id]: value }))
                                }
                                onSave={saveAllocationRow}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {!data.merchantSummary.length && (
                      <li className="px-4 py-6 text-center text-sm text-text-hint">暂无工厂/主体汇总</li>
                    )}
                  </ul>
                )}

                {reconcileView === 'fee' && reconcile && (
                  <FobContainerMatrixPanel
                    groups={buildContainerFeeGroups(
                      reconcile.containerChecks,
                      buildAllocationsByBillItem(sortedAllocations),
                    )}
                    containerStats={data.containerStats}
                    allocations={sortedAllocations}
                    feeRules={feeRules}
                    readOnly={isReadOnly}
                    editAlloc={editAlloc}
                    savingRowId={savingRowId}
                    settlementType={data.settlementType}
                    onEditAmount={(id, value) => setEditAlloc((prev) => ({ ...prev, [id]: value }))}
                    onSaveRow={saveAllocationRow}
                    onAssignFullAmount={assignFullFeeAmount}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {!sortedAllocations.length && !calculate.isPending && (
            <p className="text-sm text-text-hint">尚未执行分摊核算，点击上方按钮开始计算</p>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-4">
          {!workflow.calculated && (
            <AiBanner
              message="工厂/主体汇总需在分摊核算完成后生成"
              onFix={() => setTab('reconcile')}
              fixLabel="去分摊核算"
            />
          )}

          {workflow.calculated && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">工厂/主体汇总</CardTitle>
                {data.status === 'calculated' && (
                  <Button size="sm" variant="outline" onClick={() => setTab('reconcile')}>
                    返回平账调账
                  </Button>
                )}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {paymentError && <p className="mb-3 text-sm text-red-600">{paymentError}</p>}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-text-sub">
                      <th className="p-2 font-normal">工厂/主体</th>
                      <th className="p-2 font-normal">拖车</th>
                      <th className="p-2 font-normal">货运</th>
                      <th className="p-2 font-normal">清关</th>
                      <th className="p-2 font-normal">其他</th>
                      <th className="p-2 font-normal">合计</th>
                      <th className="p-2 font-normal">是否付款</th>
                      <th className="p-2 font-normal">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.merchantSummary.map((s) => {
                      const { status, remark: remarkValue } = resolvePaymentDraft(
                        s.merchantCode,
                        s,
                        paymentStatuses,
                        paymentRemarks,
                      );
                      const pendingNotRequired =
                        status === 'not_required' && !remarkValue.trim();
                      return (
                        <tr key={s.merchantCode} className="border-b border-border/50">
                          <td className="p-2">
                            <span className="font-mono">{s.merchantCode}</span>
                            {s.merchantName && (
                              <span className="ml-2 text-text-sub">{s.merchantName}</span>
                            )}
                            {s.grandTotal === 0 && (
                              <span className="ml-2 text-xs text-text-hint">可标为无需支付</span>
                            )}
                          </td>
                          <td className="p-2 font-numeric">{s.truckingTotal.toFixed(2)}</td>
                          <td className="p-2 font-numeric">{s.freightTotal.toFixed(2)}</td>
                          <td className="p-2 font-numeric">{s.customsTotal.toFixed(2)}</td>
                          <td className="p-2 font-numeric">{s.otherTotal.toFixed(2)}</td>
                          <td className="p-2 font-medium font-numeric text-primary">
                            {s.grandTotal.toFixed(2)}
                          </td>
                          <td className="p-2">
                            <select
                              className="h-8 min-w-[110px] rounded-md border border-input bg-card px-2 text-sm"
                              value={status}
                              disabled={patchPayment.isPending}
                              onChange={(e) =>
                                handlePaymentStatusChange(
                                  s.merchantCode,
                                  e.target.value as PaymentStatus,
                                  remarkValue,
                                )
                              }
                            >
                              {PAYMENT_STATUS_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <div className="space-y-1">
                              <Input
                                className="h-8 min-w-[160px] text-sm"
                                placeholder={status === 'not_required' ? '必填' : '可选'}
                                value={remarkValue}
                                disabled={patchPayment.isPending}
                                onChange={(e) =>
                                  setPaymentRemarks((prev) => ({
                                    ...prev,
                                    [s.merchantCode]: e.target.value,
                                  }))
                                }
                                onBlur={(e) =>
                                  handlePaymentRemarkBlur(
                                    s.merchantCode,
                                    s,
                                    e.target.value,
                                  )
                                }
                              />
                              {pendingNotRequired && (
                                <p className="text-xs text-text-hint">填写备注后自动保存</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {!data.merchantSummary.length && (
                      <tr>
                        <td colSpan={8} className="p-4 text-center text-text-hint">
                          核算完成但暂无工厂/主体汇总数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={calculateConfirmOpen}
        onOpenChange={setCalculateConfirmOpen}
        title="分摊核算确认"
        description="确认仍要执行分摊核算？"
        lines={calculateConfirmWarnings}
        confirmLabel="继续核算"
        loading={calculate.isPending}
        onConfirm={() => calculate.mutate()}
      />
    </div>
  );
}
