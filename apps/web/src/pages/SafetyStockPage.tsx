import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

function rowKey(skuId: string, warehouseCode: string) {
  return `${skuId}::${warehouseCode}`;
}

export function SafetyStockPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['safety-stock'],
    queryFn: api.getSafetyStock,
  });

  const [editing, setEditing] = useState<
    Record<string, { safetyStockQty: number; reorderPoint: number; reorderQty: number }>
  >({});

  const calc = useMutation({
    mutationFn: ({ skuId, warehouseCode }: { skuId: string; warehouseCode: string }) =>
      api.calculateSafetyStock(skuId, warehouseCode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['safety-stock'] }),
  });

  const save = useMutation({
    mutationFn: ({
      skuId,
      warehouseCode,
      data,
    }: {
      skuId: string;
      warehouseCode: string;
      data: { safetyStockQty: number; reorderPoint: number; reorderQty: number };
    }) => api.updateSafetyStock(skuId, data, warehouseCode),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['safety-stock'] }),
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="安全库存设置" />
      <Card>
        <CardHeader>
          <CardTitle>安全库存参数</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-text-sub">
            支持按仓库独立配置；手动编辑或本地 EOQ/ROP 计算。需先有销量历史数据才能自动计算。
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">仓库</th>
                <th className="p-2 font-normal">安全库存</th>
                <th className="p-2 font-normal">ROP</th>
                <th className="p-2 font-normal">EOQ</th>
                <th className="p-2 font-normal">方式</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const key = rowKey(item.skuId, item.warehouseCode ?? 'ALL');
                const edit = editing[key] ?? {
                  safetyStockQty: item.safetyStockQty ?? 0,
                  reorderPoint: item.reorderPoint ?? 0,
                  reorderQty: item.reorderQty ?? 0,
                };
                const wh = item.warehouseCode ?? 'ALL';
                return (
                  <tr key={key} className="border-b border-border/60">
                    <td className="p-2 font-mono text-text-main">{item.skuCode}</td>
                    <td className="p-2 font-mono text-text-sub">{wh}</td>
                    <td className="p-2">
                      <Input
                        type="number"
                        className="h-8 w-20"
                        value={edit.safetyStockQty}
                        onChange={(e) =>
                          setEditing({ ...editing, [key]: { ...edit, safetyStockQty: +e.target.value } })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        className="h-8 w-20"
                        value={edit.reorderPoint}
                        onChange={(e) =>
                          setEditing({ ...editing, [key]: { ...edit, reorderPoint: +e.target.value } })
                        }
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        className="h-8 w-20"
                        value={edit.reorderQty}
                        onChange={(e) =>
                          setEditing({ ...editing, [key]: { ...edit, reorderQty: +e.target.value } })
                        }
                      />
                    </td>
                    <td className="p-2 text-text-sub">{item.calcMethod ?? '未设置'}</td>
                    <td className="space-x-1 p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => save.mutate({ skuId: item.skuId, warehouseCode: wh, data: edit })}
                        disabled={save.isPending}
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => calc.mutate({ skuId: item.skuId, warehouseCode: wh })}
                        disabled={calc.isPending}
                      >
                        计算
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-text-hint">
                    暂无 SKU，请先创建或导入
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
