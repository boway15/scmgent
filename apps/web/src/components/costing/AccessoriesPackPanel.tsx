import type { CostingBomLine } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  lines: CostingBomLine[];
  costStale: boolean;
};

function parseOuterMm(spec: string): { length: string; width: string; thickness: string } | null {
  const match = spec.match(/外径\s*(\d+)\s*[×xX]\s*(\d+)\s*[×xX]\s*(\d+)/);
  if (!match) return null;
  return { length: match[1]!, width: match[2]!, thickness: match[3]! };
}

function isPackLine(line: CostingBomLine): boolean {
  return line.category === '包装';
}

function isHardwareLine(line: CostingBomLine): boolean {
  return line.category === '五金' || /防倾倒/.test(line.materialName);
}

export function AccessoriesPackPanel({ lines, costStale }: Props) {
  const hardware = lines.filter(isHardwareLine);
  const packs = lines.filter(isPackLine);
  if (!hardware.length && !packs.length) return null;
  const money = (value: number) => (costStale ? '—' : `¥${value.toFixed(2)}`);
  const price = (line: CostingBomLine) =>
    costStale || line.effectiveUnitPrice === null ? '—' : `¥${line.effectiveUnitPrice.toFixed(2)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>配件与包装</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hardware.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-sub">
                <th className="p-1 font-medium">配件</th>
                <th className="p-1 font-medium">规格</th>
                <th className="p-1 font-medium">单位</th>
                <th className="p-1 font-medium">数量</th>
                <th className="p-1 font-medium">单价</th>
                <th className="p-1 font-medium">成本</th>
              </tr>
            </thead>
            <tbody>
              {hardware.map((line) => (
                <tr key={line.id} className="border-t border-border/60">
                  <td className="p-1">{line.materialName}</td>
                  <td className="p-1 text-text-sub">{line.spec?.trim() || '—'}</td>
                  <td className="p-1">{line.unit}</td>
                  <td className="p-1 font-mono">{line.qtyNet}</td>
                  <td className="p-1 font-mono">{price(line)}</td>
                  <td className="p-1 font-mono">{money(line.lineAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {packs.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-sub">
                <th className="p-1 font-medium">包装</th>
                <th className="p-1 font-medium">单位</th>
                <th className="p-1 font-medium">单价</th>
                <th className="p-1 font-medium">数量</th>
                <th className="p-1 font-medium">长度 mm</th>
                <th className="p-1 font-medium">宽度 mm</th>
                <th className="p-1 font-medium">厚度 mm</th>
                <th className="p-1 font-medium">体积 / 面积</th>
                <th className="p-1 font-medium">成本</th>
              </tr>
            </thead>
            <tbody>
              {packs.map((line) => {
                const outer = parseOuterMm(line.spec ?? '');
                const measure =
                  line.unit === 'm³' || line.unit === 'm²' ? `${line.qtyNet} ${line.unit}` : '—';
                return (
                  <tr key={line.id} className="border-t border-border/60">
                    <td className="p-1">{line.materialName}</td>
                    <td className="p-1">{line.unit}</td>
                    <td className="p-1 font-mono">{price(line)}</td>
                    <td className="p-1 font-mono">{line.qtyNet}</td>
                    <td className="p-1 font-mono">{outer?.length ?? '—'}</td>
                    <td className="p-1 font-mono">{outer?.width ?? '—'}</td>
                    <td className="p-1 font-mono">{outer?.thickness ?? '—'}</td>
                    <td className="p-1 font-mono">{measure}</td>
                    <td className="p-1 font-mono">{money(line.lineAmount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </CardContent>
    </Card>
  );
}
