import type { PointerEvent } from 'react';
import { InventoryOverviewCell } from '@/components/InventoryOverviewCell';
import { StickyDataTable, type StickyColumnDef } from '@/components/StickyDataTable';
import { cn } from '@/lib/utils';

type SalesHistoryDailyRow = {
  id: string;
  skuCode: string;
  skuName: string;
  category?: string | null;
  saleDate: string;
  qtySold: number;
  channel?: string | null;
  station?: string | null;
  salesRegion?: string | null;
  warehouseCode?: string | null;
  source: string;
};

type SalesHistoryMonthlyRow = {
  id: string;
  skuCode: string;
  skuName: string;
  category?: string | null;
  saleMonth: string;
  qtySold: number;
  channel?: string | null;
  source: string;
};

const DAILY_COLUMNS: StickyColumnDef[] = [
  { id: 'saleDate', label: '日期' },
  { id: 'skuCode', label: 'SKU' },
  { id: 'skuName', label: '名称', flexGrow: true },
  { id: 'category', label: '品类', flexGrow: true },
  { id: 'qtySold', label: '销量', align: 'right' },
  { id: 'station', label: '站点', flexGrow: true },
  { id: 'salesRegion', label: '区域', align: 'center' },
  { id: 'channel', label: '平台' },
  { id: 'warehouseCode', label: '发货仓' },
  { id: 'source', label: '来源' },
];

const MONTHLY_COLUMNS: StickyColumnDef[] = [
  { id: 'saleMonth', label: '月份' },
  { id: 'skuCode', label: 'SKU' },
  { id: 'skuName', label: '名称', flexGrow: true },
  { id: 'category', label: '品类', flexGrow: true },
  { id: 'qtySold', label: '月销量', align: 'right' },
  { id: 'channel', label: '平台' },
  { id: 'source', label: '来源' },
];

const DAILY_FROZEN = ['saleDate', 'skuCode'];
const MONTHLY_FROZEN = ['saleMonth', 'skuCode'];

function formatSourceLabel(source: string | null | undefined) {
  const raw = source?.trim() ?? '';
  if (!raw) return '—';
  const lower = raw.toLowerCase();
  if (lower === 'import') return '导入';
  if (lower.includes('feishu') || lower === '飞书') return '飞书';
  return raw;
}

function RegionBadge({ code }: { code?: string | null }) {
  const value = code?.trim();
  if (!value) return <span className="text-text-hint">—</span>;
  return (
    <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
      {value}
    </span>
  );
}

function QtyCell({ qty }: { qty: number }) {
  return (
    <span
      className={cn(
        'font-numeric tabular-nums font-semibold',
        qty > 0 ? 'text-primary' : 'text-text-sub',
      )}
    >
      {qty.toLocaleString()}
    </span>
  );
}

type ResizeProps = {
  getWidth: (columnId: string) => number;
  onResizeStart: (
    columnId: string,
    event: Pick<PointerEvent, 'clientX' | 'preventDefault' | 'stopPropagation'>,
  ) => void;
  layoutKey?: string | number;
};

type DailyProps = ResizeProps & {
  mode: 'daily';
  items: SalesHistoryDailyRow[];
  emptyHint: string;
};

type MonthlyProps = ResizeProps & {
  mode: 'monthly';
  items: SalesHistoryMonthlyRow[];
  emptyHint: string;
};

function renderDailyCell(row: SalesHistoryDailyRow, columnId: string) {
  switch (columnId) {
    case 'saleDate':
      return (
        <InventoryOverviewCell
          value={String(row.saleDate).slice(0, 10)}
          className="font-mono tabular-nums text-text-main"
        />
      );
    case 'skuCode':
      return <InventoryOverviewCell value={row.skuCode} className="font-mono text-primary" />;
    case 'skuName':
      return <InventoryOverviewCell value={row.skuName || '—'} className="text-text-main" />;
    case 'category':
      return <InventoryOverviewCell value={row.category ?? '—'} className="text-text-sub" />;
    case 'qtySold':
      return <QtyCell qty={row.qtySold} />;
    case 'station':
      return <InventoryOverviewCell value={row.station || '—'} className="text-text-sub" />;
    case 'salesRegion':
      return <RegionBadge code={row.salesRegion} />;
    case 'channel':
      return (
        <InventoryOverviewCell value={row.channel?.toUpperCase() ?? '—'} className="text-text-sub" />
      );
    case 'warehouseCode':
      return (
        <InventoryOverviewCell value={row.warehouseCode ?? '—'} className="font-mono text-text-sub" />
      );
    case 'source':
      return <span className="whitespace-nowrap text-text-sub">{formatSourceLabel(row.source)}</span>;
    default:
      return null;
  }
}

function renderMonthlyCell(row: SalesHistoryMonthlyRow, columnId: string) {
  switch (columnId) {
    case 'saleMonth':
      return (
        <InventoryOverviewCell
          value={row.saleMonth}
          className="font-mono tabular-nums text-text-main"
        />
      );
    case 'skuCode':
      return <InventoryOverviewCell value={row.skuCode} className="font-mono text-primary" />;
    case 'skuName':
      return <InventoryOverviewCell value={row.skuName || '—'} className="text-text-main" />;
    case 'category':
      return <InventoryOverviewCell value={row.category ?? '—'} className="text-text-sub" />;
    case 'qtySold':
      return <QtyCell qty={row.qtySold} />;
    case 'channel':
      return (
        <InventoryOverviewCell value={row.channel?.toUpperCase() ?? '—'} className="text-text-sub" />
      );
    case 'source':
      return <span className="text-text-sub">{formatSourceLabel(row.source)}</span>;
    default:
      return null;
  }
}

export function SalesHistoryDataTable(props: DailyProps | MonthlyProps) {
  const { getWidth, onResizeStart, emptyHint, layoutKey } = props;

  if (props.mode === 'daily') {
    return (
      <StickyDataTable
        columns={DAILY_COLUMNS}
        items={props.items}
        rowKey={(row) => row.id}
        frozenColumnIds={DAILY_FROZEN}
        getWidth={getWidth}
        onResizeStart={onResizeStart}
        emptyLabel={emptyHint}
        layoutKey={layoutKey}
        renderCell={renderDailyCell}
      />
    );
  }

  return (
    <StickyDataTable
      columns={MONTHLY_COLUMNS}
      items={props.items}
      rowKey={(row) => row.id}
      frozenColumnIds={MONTHLY_FROZEN}
      getWidth={getWidth}
      onResizeStart={onResizeStart}
      emptyLabel={emptyHint}
      layoutKey={layoutKey}
      renderCell={renderMonthlyCell}
    />
  );
}
