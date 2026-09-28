import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type PurchaseDraftStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';

type EditableMilestone = 'etd' | 'etaPort' | 'etaWarehouse' | 'etaAvailable';

const MILESTONE_FIELDS: Array<{ key: EditableMilestone; label: string }> = [
  { key: 'etd', label: 'ETD' },
  { key: 'etaPort', label: '到港日' },
  { key: 'etaWarehouse', label: '到仓日' },
  { key: 'etaAvailable', label: '预计可售日' },
];

const STATUS_LABEL: Record<PurchaseDraftStatus, string> = {
  draft: '待确认',
  confirmed: '已确认',
  in_production: '生产中',
  ready_to_ship: '待发货',
  in_transit: '在途',
  partial_received: '部分到货',
  received: '已收货',
  exception: '异常',
  cancelled: '已取消',
};

function displaySellableDate(d: {
  etaAvailable?: string | null;
  confirmedDeliveryDate?: string | null;
  expectedDate?: string | null;
}) {
  return d.etaAvailable ?? d.confirmedDeliveryDate ?? d.expectedDate ?? '-';
}

const NEXT_ACTION: Partial<
  Record<PurchaseDraftStatus, { label: string; status: PurchaseDraftStatus }[]>
> = {
  confirmed: [{ label: '标记生产中', status: 'in_production' }],
  in_production: [{ label: '标记待发货', status: 'ready_to_ship' }],
  ready_to_ship: [{ label: '标记在途', status: 'in_transit' }],
  in_transit: [],
  partial_received: [],
  exception: [{ label: '恢复已确认', status: 'confirmed' }],
};

const SHIPMENT_LINK_STATUSES: PurchaseDraftStatus[] = [
  'ready_to_ship',
  'in_transit',
  'partial_received',
  'in_production',
];

export function PurchaseTrackingPage() {
  const [searchParams] = useSearchParams();
  const statusFilter = (searchParams.get('status') as PurchaseDraftStatus | null) ?? undefined;
  const qc = useQueryClient();
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [exceptionReason, setExceptionReason] = useState<Record<string, string>>({});
  const [confirmEtaDate, setConfirmEtaDate] = useState<Record<string, string>>({});
  const [updateEtaDate, setUpdateEtaDate] = useState<Record<string, string>>({});
  const [milestoneDates, setMilestoneDates] = useState<
    Record<string, Partial<Record<EditableMilestone, string>>>
  >({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-tracking', statusFilter, page, pageSize, appliedKeyword],
    queryFn: () =>
      api.getPurchaseTracking({
        status: statusFilter,
        page,
        pageSize,
        q: appliedKeyword || undefined,
      }),
  });
  const records = data?.items ?? [];

  const { data: shipmentData } = useQuery({
    queryKey: ['shipments', 'tracking-links'],
    queryFn: () => api.getShipments({ pageSize: 500 }),
  });

  const linkedDraftIds = new Set(
    (shipmentData?.items ?? [])
      .map((shipment) => shipment.draftId)
      .filter((draftId): draftId is string => Boolean(draftId)),
  );

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      status,
      etaAvailable,
      confirmedDeliveryDate,
      etd,
      etaPort,
      etaWarehouse,
      actualShipDate,
      exceptionReason: reason,
    }: {
      id: string;
      status?: PurchaseDraftStatus;
      etaAvailable?: string;
      confirmedDeliveryDate?: string;
      etd?: string | null;
      etaPort?: string | null;
      etaWarehouse?: string | null;
      actualShipDate?: string;
      exceptionReason?: string;
    }) =>
      api.updatePurchaseTracking(id, {
        ...(status ? { status } : {}),
        etaAvailable,
        confirmedDeliveryDate,
        etd,
        etaPort,
        etaWarehouse,
        actualShipDate,
        exceptionReason: reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-tracking'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setMilestoneDates({});
    },
  });

  const receiveDraft = useMutation({
    mutationFn: ({ id, qtyReceived }: { id: string; qtyReceived: number }) =>
      api.receivePurchaseTracking(id, { qtyReceived, idempotencyKey: `${id}:${qtyReceived}:${Date.now()}` }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-tracking'] });
      qc.invalidateQueries({ queryKey: ['pmc-plan'] });
      qc.invalidateQueries({ queryKey: ['inventory-overview'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setReceiveQty({});
    },
  });

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="采购跟单" />
      <Card>
        <CardHeader>
          <CardTitle>跟单列表</CardTitle>
          <p className="text-sm text-text-sub">
            历史内部台账只读。正式跟单进度请以飞书「采购跟单」镜像为准（状态、确认交期、未入库数量等由迅捷同步）。
            交期/日期表示预计可售日（到仓上架后可售），不是到港日。
          </p>
        </CardHeader>
        <CardContent>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="跟单单号 / SKU / 计划 / 商家"
          />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">跟单单号</th>
                <th className="p-2 font-normal">来源计划</th>
                <th className="p-2 font-normal">商家</th>
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">计划/已收</th>
                <th className="p-2 font-normal">预计可售日</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">发运</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((d) => {
                const actions = NEXT_ACTION[d.status] ?? [];
                const confirmDate = confirmEtaDate[d.id] ?? d.expectedDate ?? '';
                const canReceive = ['in_transit', 'partial_received', 'ready_to_ship', 'in_production', 'confirmed'].includes(
                  d.status,
                ) && d.remainingQty > 0;
                return (
                  <tr key={d.id} className="border-b border-border/60">
                    <td className="p-2 font-mono text-text-main">{d.draftNo}</td>
                    <td className="p-2 font-mono">
                      {d.planId ? (
                        <Link to={`/pmc/${d.planId}`} className="text-primary hover:underline">
                          {d.planNo ?? d.planId.slice(0, 8)}
                        </Link>
                      ) : (
                        d.planNo ?? '-'
                      )}
                    </td>
                    <td className="p-2">{d.merchantName ?? d.merchantCode ?? '-'}</td>
                    <td className="p-2">{d.skuCode}</td>
                    <td className="p-2 font-numeric">
                      {d.qty} / {d.receivedQty ?? 0}
                      {d.remainingQty > 0 && (
                        <span className="ml-1 text-text-sub">（剩 {d.remainingQty}）</span>
                      )}
                    </td>
                    <td className="p-2">{displaySellableDate(d)}</td>
                    <td className="p-2">
                      {d.statusLabel ?? STATUS_LABEL[d.status] ?? d.status}
                      {d.exceptionReason && (
                        <p className="mt-0.5 text-xs text-destructive">{d.exceptionReason}</p>
                      )}
                    </td>
                    <td className="p-2">
                      {linkedDraftIds.has(d.id) ? (
                        <Link
                          to={`/pmc/shipments?draftId=${d.id}`}
                          className="text-primary hover:underline"
                        >
                          查看发运
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="p-2 text-xs text-text-sub">—</td>
                  </tr>
                );
              })}
              {!records.length && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-text-hint">
                    暂无历史台账记录；正式跟单请查看飞书采购镜像同步结果
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
          {receiveDraft.isError && (
            <p className="mt-4 text-sm text-destructive">{(receiveDraft.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
