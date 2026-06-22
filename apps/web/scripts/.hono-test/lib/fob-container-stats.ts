export type ContainerMerchantStat = {
  merchantCode: string;
  merchantName?: string | null;
  containerNo: string;
  volumeCbm: number;
  ticketCount: number;
};

export function buildContainerMerchantStats(
  shipments: Array<{
    merchantCode: string;
    merchantName?: string | null;
    containerNo: string;
    skuCode?: string | null;
    volumeCbm: number;
  }>,
): ContainerMerchantStat[] {
  const map = new Map<
    string,
    {
      merchantCode: string;
      merchantName?: string | null;
      containerNo: string;
      volumeCbm: number;
    }
  >();

  for (const row of shipments) {
    if (row.volumeCbm <= 0) continue;
    const key = `${row.containerNo}|${row.merchantCode}`;
    if (!map.has(key)) {
      map.set(key, {
        merchantCode: row.merchantCode,
        merchantName: row.merchantName,
        containerNo: row.containerNo,
        volumeCbm: 0,
      });
    }
    const entry = map.get(key)!;
    entry.volumeCbm += row.volumeCbm;
    if (!entry.merchantName && row.merchantName) entry.merchantName = row.merchantName;
  }

  return [...map.values()].map((e) => ({
    merchantCode: e.merchantCode,
    merchantName: e.merchantName,
    containerNo: e.containerNo,
    volumeCbm: round4(e.volumeCbm),
    // 业务规则：同一货柜内每个主体计 1 票（与 Sku 行数无关）
    ticketCount: 1,
  }));
}

export function statsByContainer(
  stats: ContainerMerchantStat[],
): Map<string, ContainerMerchantStat[]> {
  const result = new Map<string, ContainerMerchantStat[]>();
  for (const s of stats) {
    if (!result.has(s.containerNo)) result.set(s.containerNo, []);
    result.get(s.containerNo)!.push(s);
  }
  for (const [, rows] of result) {
    rows.sort((a, b) => a.merchantCode.localeCompare(b.merchantCode));
  }
  return result;
}

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}
