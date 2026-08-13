import { calcQtyGross } from './bom-math.js';
import type { CostLineInput, CostSummary } from './types.js';

export function calcCostSummary(lines: CostLineInput[]): CostSummary {
  let missingPriceCount = 0;
  let missingQtyCount = 0;
  const categoryAmounts = new Map<string, number>();

  const calculatedLines = lines.map((line) => {
    const qtyGross = calcQtyGross(line.qtyNet, line.lossRate);
    const effectiveUnitPrice = line.unitPriceOverride ?? line.bookUnitPrice;
    const lineAmount = effectiveUnitPrice === null ? 0 : qtyGross * effectiveUnitPrice;

    if (effectiveUnitPrice === null) missingPriceCount += 1;
    if (line.qtyNet === 0) missingQtyCount += 1;
    categoryAmounts.set(
      line.category,
      (categoryAmounts.get(line.category) ?? 0) + lineAmount,
    );

    return { qtyGross, effectiveUnitPrice, lineAmount };
  });

  const totalAmount = calculatedLines.reduce((sum, line) => sum + line.lineAmount, 0);
  const byCategory = Array.from(categoryAmounts, ([category, amount]) => ({
    category,
    amount,
    share: totalAmount ? amount / totalAmount : 0,
  }));

  return {
    totalAmount,
    byCategory,
    missingPriceCount,
    missingQtyCount,
    lines: calculatedLines,
  };
}
