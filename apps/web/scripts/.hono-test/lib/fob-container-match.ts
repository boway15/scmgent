import { cleanContainerNo } from './fob-bill-parsers.js';

export type ContainerMatchResult = {
  volumeCount: number;
  billCount: number;
  matchedCount: number;
  matched: string[];
  volumeOnly: string[];
  /** 账单有、体积无，且体积文件中未标记为非 FOB */
  billOnly: string[];
  /** 体积文件已识别为非 FOB，账单有费用但不参与分账 */
  nonFobOnly: string[];
  canAllocate: boolean;
};

export function uniqueContainers(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const cleaned = cleanContainerNo(v);
    if (cleaned) set.add(cleaned);
  }
  return [...set].sort();
}

export function computeContainerMatch(
  volumeContainers: Iterable<string>,
  billContainers: Iterable<string>,
  options?: { nonFobContainers?: Iterable<string> },
): ContainerMatchResult {
  const volumeSet = new Set(uniqueContainers(volumeContainers));
  const billSet = new Set(uniqueContainers(billContainers));
  const nonFobSet = new Set(uniqueContainers(options?.nonFobContainers ?? []));

  const matched = [...volumeSet].filter((c) => billSet.has(c));
  const volumeOnly = [...volumeSet].filter((c) => !billSet.has(c));
  const rawBillOnly = [...billSet].filter((c) => !volumeSet.has(c));
  const nonFobOnly = rawBillOnly.filter((c) => nonFobSet.has(c));
  const billOnly = rawBillOnly.filter((c) => !nonFobSet.has(c));

  return {
    volumeCount: volumeSet.size,
    billCount: billSet.size,
    matchedCount: matched.length,
    matched,
    volumeOnly,
    billOnly,
    nonFobOnly,
    canAllocate: matched.length > 0,
  };
}

/** 账单中存在无体积且非「非FOB」标记的柜号时应阻塞核算 */
export function blocksCalculation(match: ContainerMatchResult): boolean {
  return match.billOnly.length > 0;
}

export function buildBillOnlyBlockMessage(match: ContainerMatchResult): string {
  const preview = match.billOnly.slice(0, 5).join('、');
  const suffix =
    match.billOnly.length > 5 ? ` 等共 ${match.billOnly.length} 个柜号` : '';
  return `账单中存在无体积数据的柜号（${preview}${suffix}），请补齐 ED 体积文件或修正账单后重试`;
}

export function buildNonFobHint(match: ContainerMatchResult): string | null {
  if (!match.nonFobOnly.length) return null;
  const preview = match.nonFobOnly.slice(0, 5).join('、');
  const suffix =
    match.nonFobOnly.length > 5 ? ` 等共 ${match.nonFobOnly.length} 个柜号` : '';
  return `账单中有非 FOB 柜号（${preview}${suffix}），不参与分账`;
}

export function buildNoAllocationMessage(match: ContainerMatchResult): string {
  if (match.volumeCount === 0) {
    return '无可分摊记录：尚未导入有效体积信息';
  }
  if (match.billCount === 0) {
    return '无可分摊记录：尚未导入拖车或货代账单';
  }
  if (match.matchedCount === 0) {
    return `无可分摊记录：体积柜号与账单柜号无交集（体积 ${match.volumeCount} 柜，账单 ${match.billCount} 柜，匹配 0 柜）。请核对是否为同一账期数据，或重新导入体积/账单`;
  }
  return '无可分摊记录：费用行未能分摊，请查看下方跳过原因';
}
