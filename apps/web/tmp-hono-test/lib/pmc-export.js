function csvCell(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
function formatDate(d) {
    return String(d).slice(0, 10);
}
export function buildPmcPlanCsv(plan, items) {
    const lines = [];
    lines.push('# PMC需求计划导出');
    lines.push([
        'plan_no',
        'plan_name',
        'merchant_code',
        'merchant_name',
        'target_warehouse',
        'plan_date',
        'delivery_date',
        'status',
        'remark',
    ].join(','));
    lines.push([
        csvCell(plan.planNo),
        csvCell(plan.name),
        csvCell(plan.merchantCode),
        csvCell(plan.merchantName),
        csvCell(plan.targetWarehouseCode),
        csvCell(formatDate(plan.planDate)),
        csvCell(formatDate(plan.deliveryDate)),
        csvCell(plan.status),
        csvCell(plan.remark),
    ].join(','));
    lines.push('');
    lines.push(['sku_code', 'sku_name', 'planned_qty', 'completed_qty', 'unit', 'warehouse_code'].join(','));
    for (const item of items) {
        lines.push([
            csvCell(item.skuCode),
            csvCell(item.skuName),
            csvCell(item.plannedQty),
            csvCell(item.completedQty ?? 0),
            csvCell(item.unit),
            csvCell(item.warehouseCode),
        ].join(','));
    }
    return `\uFEFF${lines.join('\r\n')}`;
}
export async function buildPmcPlanXlsx(plan, items) {
    const XLSX = await import('xlsx');
    const headerRows = [
        ['plan_no', plan.planNo],
        ['plan_name', plan.name],
        ['merchant_code', plan.merchantCode],
        ['merchant_name', plan.merchantName ?? ''],
        ['target_warehouse', plan.targetWarehouseCode ?? ''],
        ['plan_date', formatDate(plan.planDate)],
        ['delivery_date', formatDate(plan.deliveryDate)],
        ['status', plan.status],
        ['remark', plan.remark ?? ''],
    ];
    const headerSheet = XLSX.utils.aoa_to_sheet(headerRows);
    const itemRows = items.map((item) => ({
        sku_code: item.skuCode,
        sku_name: item.skuName,
        planned_qty: item.plannedQty,
        completed_qty: item.completedQty ?? 0,
        unit: item.unit,
        warehouse_code: item.warehouseCode ?? '',
    }));
    const itemsSheet = XLSX.utils.json_to_sheet(itemRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, headerSheet, 'Plan');
    XLSX.utils.book_append_sheet(wb, itemsSheet, 'Items');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return new Uint8Array(buf);
}
