/** 分摊基数展示：账单业务编号、体积导入工厂类别 */

export function parseFactoryTypeFromRemark(remark: string | null | undefined): string | null {
  if (!remark) return null;
  const match = remark.match(/类别:([^；;]+)/);
  const value = match?.[1]?.trim();
  return value || null;
}

function joinUniqueSorted(values: Iterable<string>): string {
  const set = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN')).join(',');
}

/** 按柜聚合账单业务编号（拖车 internalNo / 货代 orderNo） */
export function buildBusinessNosByContainer(
  settlementType: 'trucking' | 'freight',
  truckingItems: Array<{ containerNo: string; internalNo?: string | null }>,
  freightItems: Array<{ containerNo: string; orderNo?: string | null }>,
): Map<string, string> {
  const byContainer = new Map<string, Set<string>>();

  const rows =
    settlementType === 'trucking'
      ? truckingItems.map((item) => ({
          containerNo: item.containerNo,
          businessNo: item.internalNo,
        }))
      : freightItems.map((item) => ({
          containerNo: item.containerNo,
          businessNo: item.orderNo,
        }));

  for (const { containerNo, businessNo } of rows) {
    const trimmed = businessNo?.trim();
    if (!trimmed) continue;
    if (!byContainer.has(containerNo)) byContainer.set(containerNo, new Set());
    byContainer.get(containerNo)!.add(trimmed);
  }

  const result = new Map<string, string>();
  for (const [containerNo, values] of byContainer) {
    result.set(containerNo, joinUniqueSorted(values));
  }
  return result;
}

/** 按柜+工厂/主体聚合体积导入工厂类别 */
export function buildFactoryTypesByContainerMerchant(
  shipments: Array<{
    containerNo: string;
    merchantCode: string;
    remark?: string | null;
  }>,
): Map<string, string> {
  const byKey = new Map<string, Set<string>>();

  for (const shipment of shipments) {
    const factoryType = parseFactoryTypeFromRemark(shipment.remark);
    if (!factoryType) continue;
    const key = `${shipment.containerNo}|${shipment.merchantCode}`;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(factoryType);
  }

  const result = new Map<string, string>();
  for (const [key, values] of byKey) {
    result.set(key, joinUniqueSorted(values));
  }
  return result;
}

/** 按柜+工厂/主体聚合体积导入 SKU 编码 */
export function buildSkuCodesByContainerMerchant(
  shipments: Array<{
    containerNo: string;
    merchantCode: string;
    skuCode?: string | null;
  }>,
): Map<string, string> {
  const byKey = new Map<string, Set<string>>();

  for (const shipment of shipments) {
    const skuCode = shipment.skuCode?.trim();
    if (!skuCode) continue;
    const key = `${shipment.containerNo}|${shipment.merchantCode}`;
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(skuCode);
  }

  const result = new Map<string, string>();
  for (const [key, values] of byKey) {
    result.set(key, joinUniqueSorted(values));
  }
  return result;
}

export function enrichContainerStats<
  T extends {
    containerNo: string;
    merchantCode: string;
  },
>(
  stats: T[],
  params: {
    settlementType: 'trucking' | 'freight';
    truckingItems: Array<{ containerNo: string; internalNo?: string | null }>;
    freightItems: Array<{ containerNo: string; orderNo?: string | null }>;
    merchantShipments: Array<{
      containerNo: string;
      merchantCode: string;
      remark?: string | null;
      skuCode?: string | null;
    }>;
  },
): Array<T & { businessNos: string; factoryType: string; skuCodes: string }> {
  const businessNosByContainer = buildBusinessNosByContainer(
    params.settlementType,
    params.truckingItems,
    params.freightItems,
  );
  const factoryTypesByKey = buildFactoryTypesByContainerMerchant(params.merchantShipments);
  const skuCodesByKey = buildSkuCodesByContainerMerchant(params.merchantShipments);

  return stats.map((row) => ({
    ...row,
    businessNos: businessNosByContainer.get(row.containerNo) ?? '',
    factoryType: factoryTypesByKey.get(`${row.containerNo}|${row.merchantCode}`) ?? '',
    skuCodes: skuCodesByKey.get(`${row.containerNo}|${row.merchantCode}`) ?? '',
  }));
}
