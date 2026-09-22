import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type CostingBoardSheetRow, type CostingBomLine } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function money(value: number, stale: boolean) {
  return stale ? '—' : value.toFixed(2);
}

type Props = {
  projectId: string;
  rows: CostingBoardSheetRow[];
  lines: CostingBomLine[];
  costStale: boolean;
  readOnly: boolean;
};

export function BoardSheetPanel({ projectId, rows, lines, costStale, readOnly }: Props) {
  const queryClient = useQueryClient();
  const patch = useMutation({
    mutationFn: ({ lineId, processOverrides }: { lineId: string; processOverrides: Record<string, number | null> }) =>
      api.patchCostingBomLine(projectId, lineId, { processOverrides }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['costing-project', projectId] });
    },
  });

  if (!rows.length) return null;

  const totals = rows.reduce(
    (acc, row) => ({
      board: acc.board + row.boardCost,
      process: acc.process + (row.subtotal - row.boardCost),
      subtotal: acc.subtotal + row.subtotal,
    }),
    { board: 0, process: 0, subtotal: 0 },
  );

  const commit = (lineId: string | undefined, key: string, raw: string, current: number) => {
    if (!lineId || readOnly) return;
    const next = raw.trim() === '' ? 0 : Number(raw);
    if (!Number.isFinite(next) || next < 0 || next === current) return;
    const line = lines.find((item) => item.id === lineId);
    patch.mutate({
      lineId,
      processOverrides: { ...(line?.processOverrides ?? {}), [key]: next },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>板材成本核算（按每块板规格）</CardTitle>
        <p className="text-xs font-normal text-text-hint">
          采购大板 1220×2440；开料净料 {rows[0]?.usableWidthMm ?? 1200}×{rows[0]?.usableLengthMm ?? 2400}，长沿长边、宽沿短边，不旋转。
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-max min-w-full text-xs">
          <thead>
            <tr className="text-left text-text-sub">
              {[
                '序号',
                '板子',
                '材质',
                '厚',
                '元/张',
                '数量',
                '长',
                '宽',
                '净宽',
                '净长',
                '片数',
                '板材',
                '开料米',
                '开料',
                '封边米',
                '封边',
                '打孔',
                '开槽米',
                '喷漆m²',
                '小计',
              ].map((label) => (
                <th key={label} className="whitespace-nowrap p-1 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.lineId ?? `${row.materialName}-${index}`} className="border-t border-border/60">
                <td className="p-1">{index + 1}</td>
                <td className="p-1">{row.materialName}</td>
                <td className="p-1">{row.substrate}</td>
                <td className="p-1 font-mono">{row.thicknessMm ?? ''}</td>
                <td className="p-1 font-mono">{money(row.sheetPrice, costStale)}</td>
                <td className="p-1 font-mono">{row.qty}</td>
                <td className="p-1 font-mono">{row.lengthMm}</td>
                <td className="p-1 font-mono">{row.widthMm}</td>
                <td className="p-1 font-mono">{row.usableWidthMm}</td>
                <td className="p-1 font-mono">{row.usableLengthMm}</td>
                <td className="p-1 font-mono">{row.piecesPerSheet || (row.pricingMode === 'area' ? '面积' : '')}</td>
                <td className="p-1 font-mono">{money(row.boardCost, costStale)}</td>
                <td className="p-1">
                  <Input
                    className="h-7 w-16 px-1 font-mono"
                    defaultValue={row.cutMeters}
                    key={`${row.lineId}-cut-${row.cutMeters}`}
                    disabled={readOnly || patch.isPending}
                    onBlur={(event) => commit(row.lineId, 'cutMeters', event.target.value, row.cutMeters)}
                  />
                </td>
                <td className="p-1 font-mono">{money(row.cutAmount, costStale)}</td>
                <td className="p-1">
                  <Input
                    className="h-7 w-16 px-1 font-mono"
                    defaultValue={row.bandMeters}
                    disabled={readOnly || patch.isPending}
                    onBlur={(event) => commit(row.lineId, 'bandMeters', event.target.value, row.bandMeters)}
                  />
                </td>
                <td className="p-1 font-mono">{money(row.bandAmount, costStale)}</td>
                <td className="p-1">
                  <Input
                    className="h-7 w-16 px-1 font-mono"
                    defaultValue={row.drillCount}
                    disabled={readOnly || patch.isPending}
                    onBlur={(event) => commit(row.lineId, 'drillCount', event.target.value, row.drillCount)}
                  />
                </td>
                <td className="p-1">
                  <Input
                    className="h-7 w-16 px-1 font-mono"
                    defaultValue={row.grooveMeters}
                    disabled={readOnly || patch.isPending}
                    onBlur={(event) => commit(row.lineId, 'grooveMeters', event.target.value, row.grooveMeters)}
                  />
                </td>
                <td className="p-1">
                  <Input
                    className="h-7 w-16 px-1 font-mono"
                    defaultValue={row.paintAreaM2}
                    disabled={readOnly || patch.isPending}
                    onBlur={(event) => commit(row.lineId, 'paintAreaM2', event.target.value, row.paintAreaM2)}
                  />
                </td>
                <td className="p-1 font-mono">{money(row.subtotal, costStale)}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-medium">
              <td className="p-1" colSpan={11}>
                合计
              </td>
              <td className="p-1 font-mono">{money(totals.board, costStale)}</td>
              <td colSpan={7} />
              <td className="p-1 font-mono">{money(totals.subtotal, costStale)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-text-hint">
          开料/封边默认为周长米；打孔、开槽、喷漆默认为 0，失焦即保存本单覆盖。改完后需重新点「计算成本」。
        </p>
      </CardContent>
    </Card>
  );
}
