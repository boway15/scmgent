import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { CostingSummary } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CHART_COLORS = ['#FF5000', '#FF7A22', '#F59E0B', '#8B5CF6', '#3B82F6', '#10B981'];

type CostDashboardProps = {
  summary: CostingSummary;
};

function MetricCard({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <Card className={warning ? 'bg-highlight-warm' : undefined}>
      <CardContent className="pt-6">
        <p className="text-sm text-text-sub">{label}</p>
        <p className="mt-2 font-mono text-2xl font-semibold text-text-main">{value}</p>
      </CardContent>
    </Card>
  );
}

export function CostDashboard({ summary }: CostDashboardProps) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="材料总成本" value={`¥${summary.totalAmount.toFixed(2)}`} />
        <MetricCard
          label="缺价行"
          value={String(summary.missingPriceCount)}
          warning={summary.missingPriceCount > 0}
        />
        <MetricCard
          label="缺用量"
          value={String(summary.missingQtyCount)}
          warning={summary.missingQtyCount > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>成本看板</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="h-72">
            {summary.byCategory.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.byCategory}
                    dataKey="amount"
                    nameKey="category"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={2}
                  >
                    {summary.byCategory.map((item, index) => (
                      <Cell
                        key={item.category}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`¥${Number(value).toFixed(2)}`, '金额']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-text-hint">
                添加有用量和单价的材料后显示成本构成
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">大类</th>
                  <th className="p-2 text-right font-normal">金额</th>
                  <th className="p-2 text-right font-normal">占比</th>
                </tr>
              </thead>
              <tbody>
                {summary.byCategory.map((item) => (
                  <tr key={item.category} className="border-b border-border/60">
                    <td className="p-2">{item.category}</td>
                    <td className="p-2 text-right font-mono">¥{item.amount.toFixed(2)}</td>
                    <td className="p-2 text-right font-mono">{(item.share * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {!summary.byCategory.length && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-text-hint">
                      暂无成本数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
