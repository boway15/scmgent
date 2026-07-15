import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type PurchaseDraftStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

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

const NEXT_ACTION: Partial<
  Record<PurchaseDraftStatus, { label: string; status: PurchaseDraftStatus }[]>
> = {
  draft: [{ label: '确认交期', status: 'confirmed' }],
  confirmed: [{ label: '标记生产中', status: 'in_production' }],
  in_production: [{ label: '标记待发货', status: 'ready_to_ship' }],
  ready_to_ship: [{ label: '标记在途', status: 'in_transit' }],
  in_transit: [],
  partial_received: [],
  exception: [{ label: '恢复已确认', status: 'confirmed' }],
};

export function PurchaseTrackingPage() {
  const [searchParams] = useSearchParams();
  const statusFilter = (searchParams.get('status') as PurchaseDraftStatus | null) ?? undefined;
  const qc = useQueryClient();
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [exceptionReason, setExceptionReason] = useState<Record<string, string>>({});

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['purchase-tracking', statusFilter],
    queryFn: () => api.getPurchaseTracking(statusFilter),
  });

  const updateStatus = useMutation({
    mutationFn: ({
      id,
      status,
      confirmedDeliveryDate,
      actualShipDate,
      exceptionReason: reason,
    }: {
      id: string;
      status: PurchaseDraftStatus;
      confirmedDeliveryDate?: string;
      actualShipDate?: string;
      exceptionReason?: string;
    }) =>
      api.updatePurchaseTracking(id, {
        status,
        confirmedDeliveryDate,
        actualShipDate,
        exceptionReason: reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-tracking'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
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

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="采购跟单" />
      <Card>
        <CardHeader>
          <CardTitle>跟单列表</CardTitle>
          <p className="text-sm text-text-sub">
            内部履约台账，非正式采购单。确认交期 → 生产 → 发货 → 在途 → 登记到货回写库存。
            数据来自{' '}
            <Link to="/pmc/list" className="text-primary hover:underline">
              计划列表
            </Link>
            中已确认的计划。
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">跟单单号</th>
                <th className="p-2 font-normal">来源计划</th>
                <th className="p-2 font-normal">商家</th>
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">计划/已收</th>
                <th className="p-2 font-normal">承诺交期</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((d) => {
                const actions = NEXT_ACTION[d.status] ?? [];
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
                    <td className="p-2">{d.confirmedDeliveryDate ?? d.expectedDate ?? '-'}</td>
                    <td className="p-2">
                      {d.statusLabel ?? STATUS_LABEL[d.status] ?? d.status}
                      {d.exceptionReason && (
                        <p className="mt-0.5 text-xs text-destructive">{d.exceptionReason}</p>
                      )}
                    </td>
                    <td className="space-y-1 p-2">
                      <div className="flex flex-wrap gap-1">
                        {actions.map((a) => (
                          <Button
                            key={a.status}
                            size="sm"
                            variant="outline"
                            disabled={updateStatus.isPending}
                            onClick={() => updateStatus.mutate({ id: d.id, status: a.status })}
                          >
                            {a.label}
                          </Button>
                        ))}
                        {!['received', 'cancelled'].includes(d.status) && (
                          <>
                            <Input
                              className="h-8 w-28"
                              placeholder="异常原因"
                              value={exceptionReason[d.id] ?? ''}
                              onChange={(e) =>
                                setExceptionReason((prev) => ({ ...prev, [d.id]: e.target.value }))
                              }
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                updateStatus.mutate({
                                  id: d.id,
                                  status: 'exception',
                                  exceptionReason: exceptionReason[d.id] || '需人工跟进',
                                })
                              }
                            >
                              标记异常
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateStatus.mutate({ id: d.id, status: 'cancelled' })}
                            >
                              取消
                            </Button>
                          </>
                        )}
                      </div>
                      {canReceive && (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            className="h-8 w-20"
                            placeholder="到货量"
                            value={receiveQty[d.id] ?? ''}
                            onChange={(e) =>
                              setReceiveQty((prev) => ({ ...prev, [d.id]: e.target.value }))
                            }
                          />
                          <Button
                            size="sm"
                            disabled={receiveDraft.isPending || !receiveQty[d.id]}
                            onClick={() =>
                              receiveDraft.mutate({
                                id: d.id,
                                qtyReceived: Number(receiveQty[d.id]),
                              })
                            }
                          >
                            登记到货
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!records.length && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-text-hint">
                    暂无跟单记录，请先在计划列表确认计划
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {receiveDraft.isError && (
            <p className="mt-4 text-sm text-destructive">{(receiveDraft.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
