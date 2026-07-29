import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type Shipment,
  type ShipmentMilestoneInput,
  type ShipmentStatus,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export type ShipmentTab = 'all' | 'delayed';
type MilestoneKey = Exclude<ShipmentStatus, 'cancelled'>;
type MilestoneDraft = Record<MilestoneKey, { plannedAt: string; actualAt: string; remark: string }>;

export const MILESTONE_DEFINITIONS: ReadonlyArray<{ key: MilestoneKey; label: string }> = [
  { key: 'booked', label: '已订舱' },
  { key: 'loaded', label: '已装柜' },
  { key: 'departed', label: '已离港' },
  { key: 'arrived_port', label: '已到港' },
  { key: 'customs', label: '清关中' },
  { key: 'received_wh', label: '仓库签收' },
  { key: 'available', label: '已可售' },
];

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  booked: '已订舱',
  loaded: '已装柜',
  departed: '已离港',
  arrived_port: '已到港',
  customs: '清关中',
  received_wh: '仓库签收',
  available: '已可售',
  cancelled: '已取消',
};

export function shipmentListParamsForTab(tab: ShipmentTab): { delayed?: true } {
  return tab === 'delayed' ? { delayed: true } : {};
}

function milestoneDraftFromShipment(shipment: Shipment): MilestoneDraft {
  return Object.fromEntries(
    MILESTONE_DEFINITIONS.map(({ key }) => {
      const current = shipment.milestones.find((item) => item.milestone === key);
      return [
        key,
        {
          plannedAt: current?.plannedAt ?? '',
          actualAt: current?.actualAt ?? '',
          remark: current?.remark ?? '',
        },
      ];
    }),
  ) as MilestoneDraft;
}

function shortId(value?: string | null) {
  return value ? value.slice(0, 8) : '-';
}

export function ShipmentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ShipmentTab>('all');
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState<MilestoneDraft | null>(null);

  const shipments = useQuery({
    queryKey: ['shipments', tab],
    queryFn: () => api.getShipments(shipmentListParamsForTab(tab)),
  });

  const saveMilestones = useMutation({
    mutationFn: async ({
      shipmentId,
      values,
    }: {
      shipmentId: string;
      values: MilestoneDraft;
    }) => {
      const inputs: ShipmentMilestoneInput[] = MILESTONE_DEFINITIONS.map(({ key }) => ({
        milestone: key,
        plannedAt: values[key].plannedAt || null,
        actualAt: values[key].actualAt || null,
        remark: values[key].remark || null,
      }));
      await Promise.all(inputs.map((input) => api.upsertShipmentMilestone(shipmentId, input)));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shipments'] });
      setSelected(null);
      setMilestoneDraft(null);
    },
  });

  const openMilestones = (shipment: Shipment) => {
    setSelected(shipment);
    setMilestoneDraft(milestoneDraftFromShipment(shipment));
  };

  const items = shipments.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="发运管理" />

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>发运列表</CardTitle>
          <div className="flex border-b border-border" role="tablist" aria-label="发运筛选">
            {([
              ['all', '全部发运'],
              ['delayed', '延误'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={`border-b-2 px-4 py-2 text-sm ${
                  tab === value
                    ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-text-sub hover:text-text-main'
                }`}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {shipments.isLoading ? (
            <p className="text-sm text-text-sub">加载中...</p>
          ) : shipments.isError ? (
            <p className="text-sm text-destructive">
              {shipments.error instanceof Error ? shipments.error.message : '发运数据加载失败'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">单号</th>
                    <th className="p-2 font-normal">SKU</th>
                    <th className="p-2 font-normal">数量</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">柜号</th>
                    <th className="p-2 font-normal">预计可售</th>
                    <th className="p-2 font-normal">关联跟单</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((shipment) => (
                    <tr key={shipment.id} className="border-b border-border/60">
                      <td className="p-2 font-mono text-text-main">{shipment.shipmentNo}</td>
                      <td className="p-2 font-mono" title={shipment.skuId}>
                        {shortId(shipment.skuId)}
                      </td>
                      <td className="p-2 font-numeric">{shipment.qty}</td>
                      <td className="p-2">
                        {STATUS_LABELS[shipment.status] ?? shipment.status}
                        {shipment.delayDays > 0 && (
                          <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs text-red-600">
                            延误 {shipment.delayDays} 天
                          </span>
                        )}
                      </td>
                      <td className="p-2 font-mono">{shipment.containerNo ?? '-'}</td>
                      <td className="p-2">{shipment.etaAvailable ?? '-'}</td>
                      <td className="p-2 font-mono">
                        {shipment.draftId ? (
                          <Link to="/pmc/tracking" className="text-primary hover:underline">
                            {shortId(shipment.draftId)}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" onClick={() => openMilestones(shipment)}>
                          维护里程碑
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-text-hint">
                        {tab === 'delayed' ? '暂无延误发运' : '暂无发运记录'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && milestoneDraft && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="dialog" aria-modal="true">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-card p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-text-main">发运里程碑</h2>
                <p className="mt-1 font-mono text-sm text-text-sub">{selected.shipmentNo}</p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(null);
                  setMilestoneDraft(null);
                }}
              >
                关闭
              </Button>
            </div>

            <div className="space-y-3">
              {MILESTONE_DEFINITIONS.map(({ key, label }) => (
                <div key={key} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-medium text-text-main">{label}</h3>
                    {(selected.milestones.find((item) => item.milestone === key)?.delayDays ?? 0) > 0 && (
                      <span className="text-xs text-red-600">
                        延误 {selected.milestones.find((item) => item.milestone === key)?.delayDays} 天
                      </span>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm text-text-sub">
                      <span>计划日期</span>
                      <Input
                        type="date"
                        value={milestoneDraft[key].plannedAt}
                        onChange={(event) =>
                          setMilestoneDraft({
                            ...milestoneDraft,
                            [key]: { ...milestoneDraft[key], plannedAt: event.target.value },
                          })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-sm text-text-sub">
                      <span>实际日期</span>
                      <Input
                        type="date"
                        value={milestoneDraft[key].actualAt}
                        onChange={(event) =>
                          setMilestoneDraft({
                            ...milestoneDraft,
                            [key]: { ...milestoneDraft[key], actualAt: event.target.value },
                          })
                        }
                      />
                    </label>
                  </div>
                  <Input
                    className="mt-3"
                    placeholder="备注"
                    value={milestoneDraft[key].remark}
                    onChange={(event) =>
                      setMilestoneDraft({
                        ...milestoneDraft,
                        [key]: { ...milestoneDraft[key], remark: event.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>

            {saveMilestones.isError && (
              <p className="mt-4 text-sm text-destructive">
                {saveMilestones.error instanceof Error ? saveMilestones.error.message : '保存失败'}
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <Button
                disabled={saveMilestones.isPending}
                onClick={() =>
                  saveMilestones.mutate({ shipmentId: selected.id, values: milestoneDraft })
                }
              >
                {saveMilestones.isPending ? '保存中...' : '保存里程碑'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
