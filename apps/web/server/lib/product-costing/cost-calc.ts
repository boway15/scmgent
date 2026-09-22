import { calcQtyGross } from './bom-math.js';
import { boardUsageAreaM2, shouldCostBoardByArea } from './board-usage.js';
import {
  DEFAULT_PROCESS_RATES,
  buildBoardSheetRow,
  isRolledProcessLine,
  resolveSheetPrice,
  type BoardSheetRow,
  type ProcessRates,
} from './board-sheet.js';
import { isBundledOtherHardware } from './hardware-facts.js';
import { isDepartmentFooterName } from './sanitize-bom-lines.js';
import type { CostLineInput, CostSummary } from './types.js';

const PROCESS_CATEGORY = '加工';

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function calcLineAmount(line: CostLineInput): {
  qtyGross: number;
  effectiveUnitPrice: number | null;
  lineAmount: number;
  usageAreaM2: number | null;
} {
  const usageAreaM2 = boardUsageAreaM2(line.spec ?? '', line.qtyNet, line.lossRate);
  const areaBased = shouldCostBoardByArea(line.category, line.spec ?? '', line.qtyNet);

  if (areaBased && usageAreaM2 !== null) {
    const pricePerM2 = line.unitPriceOverride ?? line.pricePerM2 ?? null;
    if (pricePerM2 !== null) {
      return {
        qtyGross: usageAreaM2,
        effectiveUnitPrice: pricePerM2,
        lineAmount: money(usageAreaM2 * pricePerM2),
        usageAreaM2,
      };
    }
  }

  const qtyGross = calcQtyGross(line.qtyNet, line.lossRate);
  const effectiveUnitPrice = line.unitPriceOverride ?? line.bookUnitPrice;
  return {
    qtyGross,
    effectiveUnitPrice,
    lineAmount: effectiveUnitPrice === null ? 0 : money(qtyGross * effectiveUnitPrice),
    usageAreaM2,
  };
}

export function calcCostSummary(
  lines: CostLineInput[],
  fees: Array<{ name: string; rate: number; scope: import('./costing-scope.js').MatchScope }> = [],
  options?: {
    otherHardwarePct?: number | null;
    processRates?: ProcessRates;
  },
): CostSummary {
  let missingPriceCount = 0;
  let missingQtyCount = 0;
  let materialAmount = 0;
  let processAmount = 0;
  const categoryAmounts = new Map<string, number>();
  const boardSheet: BoardSheetRow[] = [];
  const rates = options?.processRates ?? DEFAULT_PROCESS_RATES;

  const calculatedLines = lines.map((line) => {
    const bundled =
      isBundledOtherHardware(line.materialName ?? '') ||
      isDepartmentFooterName(line.materialName ?? '');
    const rolled = isRolledProcessLine(line.category, line.materialName ?? '');

    if (bundled || rolled) {
      return { qtyGross: 0, effectiveUnitPrice: 0, lineAmount: 0, usageAreaM2: null };
    }

    const sheet =
      line.category === '板材'
        ? buildBoardSheetRow({
            lineId: line.lineId,
            materialName: line.materialName ?? '',
            spec: line.spec ?? '',
            qtyNet: line.qtyNet,
            sheetPrice: resolveSheetPrice(line),
            defaultSubstrate: line.defaultSubstrate,
            rates,
            overrides: line.processOverrides,
            areaFallback:
              shouldCostBoardByArea(line.category, line.spec ?? '', line.qtyNet) &&
              line.pricePerM2 != null
                ? {
                    usageAreaM2: boardUsageAreaM2(line.spec ?? '', line.qtyNet, line.lossRate) ?? 0,
                    pricePerM2: line.unitPriceOverride ?? line.pricePerM2,
                  }
                : null,
          })
        : null;

    if (sheet) {
      boardSheet.push(sheet);
      const boardUnit = sheet.qty ? money(sheet.boardCost / sheet.qty) : sheet.sheetPrice;
      if (sheet.boardCost === 0 && resolveSheetPrice(line) === null && sheet.pricingMode !== 'area') {
        missingPriceCount += 1;
      }
      if (line.qtyNet === 0) missingQtyCount += 1;
      materialAmount += sheet.boardCost;
      processAmount += money(sheet.subtotal - sheet.boardCost);
      categoryAmounts.set('板材', (categoryAmounts.get('板材') ?? 0) + sheet.boardCost);
      categoryAmounts.set('加工', (categoryAmounts.get('加工') ?? 0) + money(sheet.subtotal - sheet.boardCost));
      return {
        qtyGross: line.qtyNet,
        effectiveUnitPrice: boardUnit,
        lineAmount: sheet.subtotal,
        usageAreaM2: boardUsageAreaM2(line.spec ?? '', line.qtyNet, line.lossRate),
      };
    }

    const calculated = calcLineAmount(line);
    if (calculated.effectiveUnitPrice === null) missingPriceCount += 1;
    if (line.qtyNet === 0) missingQtyCount += 1;
    categoryAmounts.set(
      line.category,
      (categoryAmounts.get(line.category) ?? 0) + calculated.lineAmount,
    );
    if (line.category === PROCESS_CATEGORY) processAmount += calculated.lineAmount;
    else materialAmount += calculated.lineAmount;
    return calculated;
  });

  const lineTotal = materialAmount + processAmount;
  const feeItems = fees.map((fee) => ({
    name: fee.name,
    rate: fee.rate,
    amount: money(lineTotal * fee.rate),
    scope: fee.scope,
  }));
  const feeAmount = feeItems.reduce((sum, item) => sum + item.amount, 0);
  const totalAmount = money(lineTotal + feeAmount);
  const byCategory = Array.from(categoryAmounts, ([category, amount]) => ({
    category,
    amount,
    share: totalAmount ? amount / totalAmount : 0,
  }));

  return {
    materialAmount: money(materialAmount),
    processAmount: money(processAmount),
    feeAmount,
    totalAmount,
    byCategory,
    feeItems,
    missingPriceCount,
    missingQtyCount,
    lines: calculatedLines,
    boardSheet,
  };
}

export type { BoardSheetRow, ProcessOverrides, ProcessRates };
