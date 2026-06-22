/** 分摊明细固定排序：柜号 → 费用项 → id，避免列表顺序跳动 */
export function compareAllocationRows(a, b) {
    const byContainer = a.containerNo.localeCompare(b.containerNo, 'en');
    if (byContainer !== 0)
        return byContainer;
    const byFee = a.feeType.localeCompare(b.feeType, 'zh-CN');
    if (byFee !== 0)
        return byFee;
    if (a.id && b.id)
        return a.id.localeCompare(b.id);
    return 0;
}
export function sortAllocationRows(rows) {
    return [...rows].sort(compareAllocationRows);
}
export function aggregateMerchantVolumes(rows) {
    const byContainer = new Map();
    for (const row of rows) {
        if (!byContainer.has(row.containerNo))
            byContainer.set(row.containerNo, new Map());
        const merchants = byContainer.get(row.containerNo);
        const existing = merchants.get(row.merchantCode);
        if (existing) {
            existing.volumeCbm += row.volumeCbm;
            if (!existing.merchantName && row.merchantName)
                existing.merchantName = row.merchantName;
        }
        else {
            merchants.set(row.merchantCode, {
                merchantCode: row.merchantCode,
                merchantName: row.merchantName,
                volumeCbm: row.volumeCbm,
            });
        }
    }
    const result = new Map();
    for (const [container, merchants] of byContainer) {
        result.set(container, [...merchants.values()].sort((a, b) => a.merchantCode.localeCompare(b.merchantCode)));
    }
    return result;
}
export function mergeVolumeAndTicketStats(volumeStats, ticketStats) {
    const result = new Map();
    const containers = new Set([...volumeStats.keys(), ...ticketStats.keys()]);
    for (const containerNo of containers) {
        const volRows = volumeStats.get(containerNo) ?? [];
        const ticketRows = ticketStats.get(containerNo) ?? [];
        const merged = new Map();
        for (const v of volRows) {
            merged.set(v.merchantCode, { ...v });
        }
        for (const t of ticketRows) {
            const existing = merged.get(t.merchantCode);
            if (existing) {
                existing.ticketCount = t.ticketCount;
                if (!existing.merchantName && t.merchantName)
                    existing.merchantName = t.merchantName;
            }
            else {
                merged.set(t.merchantCode, {
                    merchantCode: t.merchantCode,
                    merchantName: t.merchantName,
                    volumeCbm: t.volumeCbm,
                    ticketCount: t.ticketCount,
                });
            }
        }
        result.set(containerNo, [...merged.values()].sort((a, b) => a.merchantCode.localeCompare(b.merchantCode)));
    }
    return result;
}
export function allocateFeesByVolume(merchants, fee) {
    const totalVolume = merchants.reduce((s, m) => s + m.volumeCbm, 0);
    if (totalVolume <= 0)
        return [];
    const totalTickets = merchants.reduce((s, m) => s + (m.ticketCount ?? 0), 0);
    return splitAmount(merchants, fee, totalVolume, (m) => m.volumeCbm, (m, ratio, amount, isLast) => ({
        merchantVolumeCbm: m.volumeCbm,
        volumeRatio: round6(ratio),
        ticketCount: m.ticketCount,
        ticketRatio: totalTickets > 0 ? round6((m.ticketCount ?? 0) / totalTickets) : undefined,
        allocatedAmountCny: amount,
        isTailAdjustment: isLast,
    }));
}
export function allocateFeesByTicket(merchants, fee) {
    const totalTickets = merchants.reduce((s, m) => s + (m.ticketCount ?? 0), 0);
    if (totalTickets <= 0) {
        return allocateFeesByVolume(merchants, fee);
    }
    return splitAmount(merchants.filter((m) => (m.ticketCount ?? 0) > 0), fee, totalTickets, (m) => m.ticketCount ?? 0, (m, ratio, amount, isLast) => ({
        merchantVolumeCbm: m.volumeCbm,
        volumeRatio: m.volumeCbm > 0 ? round6(m.volumeCbm / merchants.reduce((s, x) => s + x.volumeCbm, 0)) : 0,
        ticketCount: m.ticketCount,
        ticketRatio: round6(ratio),
        allocatedAmountCny: amount,
        isTailAdjustment: isLast,
    }));
}
/** 柜内仅一个主体时，全部费用归该主体（无视分摊规则） */
export function allocateFeeSingleMerchant(merchant, fee) {
    return [
        {
            containerNo: fee.containerNo,
            merchantCode: merchant.merchantCode,
            merchantName: merchant.merchantName,
            stage: fee.stage,
            feeType: fee.feeType,
            sourceBillType: fee.sourceBillType,
            sourceBillItemId: fee.key,
            sourceRef: fee.sourceRef,
            allocationMethod: fee.allocationMethod,
            sourceAmountCny: fee.amountCny,
            merchantVolumeCbm: merchant.volumeCbm,
            volumeRatio: 1,
            ticketCount: merchant.ticketCount,
            ticketRatio: 1,
            allocatedAmountCny: round2(fee.amountCny),
            isTailAdjustment: true,
        },
    ];
}
export function allocateFeeFixed(merchants, fee) {
    let targetCode = fee.assignedMerchantCode?.trim();
    if (!targetCode) {
        if (merchants.length === 1) {
            targetCode = merchants[0].merchantCode;
        }
        else {
            return [];
        }
    }
    const target = merchants.find((m) => m.merchantCode === targetCode);
    return [
        {
            containerNo: fee.containerNo,
            merchantCode: targetCode,
            merchantName: target?.merchantName,
            stage: fee.stage,
            feeType: fee.feeType,
            sourceBillType: fee.sourceBillType,
            sourceBillItemId: fee.key,
            sourceRef: fee.sourceRef,
            allocationMethod: 'fixed',
            sourceAmountCny: fee.amountCny,
            merchantVolumeCbm: target?.volumeCbm ?? 0,
            volumeRatio: target ? 1 : 0,
            ticketCount: target?.ticketCount,
            ticketRatio: target ? 1 : 0,
            allocatedAmountCny: round2(fee.amountCny),
            isTailAdjustment: true,
        },
    ];
}
/** 人工/待确认：柜内每个主体一行，默认承担 ¥0 */
export function allocateFeeManualAcrossMerchants(merchants, fee, amountFor) {
    if (!merchants.length)
        return [];
    return merchants.map((m, idx) => ({
        containerNo: fee.containerNo,
        merchantCode: m.merchantCode,
        merchantName: m.merchantName,
        stage: fee.stage,
        feeType: fee.feeType,
        sourceBillType: fee.sourceBillType,
        sourceBillItemId: fee.key,
        sourceRef: fee.sourceRef,
        allocationMethod: 'manual',
        sourceAmountCny: fee.amountCny,
        merchantVolumeCbm: m.volumeCbm,
        volumeRatio: 0,
        ticketCount: m.ticketCount,
        ticketRatio: 0,
        allocatedAmountCny: round2(amountFor(m)),
        isTailAdjustment: idx === merchants.length - 1,
    }));
}
/** 待异常确认：各主体默认 ¥0 */
export function allocateFeeManualPending(merchants, fee) {
    return allocateFeeManualAcrossMerchants(merchants, fee, () => 0);
}
function allocationSum(rows) {
    return round2(rows.reduce((s, r) => s + r.allocatedAmountCny, 0));
}
/** 未平账或尚无分摊行时，需为柜内各主体补齐占位行（默认 ¥0） */
export function shouldPadMerchantPlaceholders(fee, rows) {
    if (!rows.length)
        return true;
    return Math.abs(fee.amountCny - allocationSum(rows)) > 0.01;
}
/** 为柜内缺失主体补 ¥0 行，便于未平账项在界面上直接调账 */
export function padMissingMerchantAllocations(merchants, fee, rows) {
    if (!merchants.length)
        return rows;
    const existingCodes = new Set(rows.map((r) => r.merchantCode));
    const missing = merchants.filter((m) => !existingCodes.has(m.merchantCode));
    if (!missing.length)
        return rows;
    const totalVolume = merchants.reduce((s, m) => s + m.volumeCbm, 0);
    const totalTickets = merchants.reduce((s, m) => s + (m.ticketCount ?? 0), 0);
    const placeholders = missing.map((m) => ({
        containerNo: fee.containerNo,
        merchantCode: m.merchantCode,
        merchantName: m.merchantName,
        stage: fee.stage,
        feeType: fee.feeType,
        sourceBillType: fee.sourceBillType,
        sourceBillItemId: fee.key,
        sourceRef: fee.sourceRef,
        allocationMethod: fee.allocationMethod,
        sourceAmountCny: fee.amountCny,
        merchantVolumeCbm: m.volumeCbm,
        volumeRatio: totalVolume > 0 ? round6(m.volumeCbm / totalVolume) : 0,
        ticketCount: m.ticketCount,
        ticketRatio: totalTickets > 0 ? round6((m.ticketCount ?? 0) / totalTickets) : undefined,
        allocatedAmountCny: 0,
        isTailAdjustment: false,
    }));
    return [...rows, ...placeholders].sort((a, b) => a.merchantCode.localeCompare(b.merchantCode));
}
export function allocateFeeManual(merchants, fee) {
    const targetCode = fee.assignedMerchantCode?.trim();
    if (!targetCode) {
        return allocateFeeManualPending(merchants, fee);
    }
    return allocateFeeManualAcrossMerchants(merchants, fee, (m) => m.merchantCode === targetCode ? fee.amountCny : 0);
}
export function allocateFees(merchantStatsByContainer, feeLines) {
    const allocations = [];
    const warnings = [];
    const feesByContainer = new Map();
    for (const fee of feeLines) {
        if (!feesByContainer.has(fee.containerNo))
            feesByContainer.set(fee.containerNo, []);
        feesByContainer.get(fee.containerNo).push(fee);
    }
    for (const [containerNo, fees] of feesByContainer) {
        const merchants = merchantStatsByContainer.get(containerNo);
        if (!merchants?.length) {
            warnings.push(`柜号 ${containerNo} 无工厂/主体体积/票数数据，已跳过 ${fees.length} 项费用`);
            continue;
        }
        for (const fee of fees) {
            if (fee.isException && fee.exceptionStatus === 'pending') {
                allocations.push(...allocateFeeManualPending(merchants, fee));
                continue;
            }
            if (fee.isException && fee.exceptionStatus === 'rejected') {
                warnings.push(`柜号 ${containerNo} 费用 ${fee.feeType} 已驳回，不参与分摊`);
                continue;
            }
            if (merchants.length === 1) {
                allocations.push(...allocateFeeSingleMerchant(merchants[0], fee));
                continue;
            }
            let rows = [];
            const method = fee.allocationMethod;
            if (method === 'manual') {
                rows = allocateFeeManual(merchants, fee);
                if (!rows.length) {
                    warnings.push(`柜号 ${containerNo} 费用 ${fee.feeType} 人工分摊缺少归属工厂/主体`);
                }
            }
            else if (method === 'fixed') {
                rows = allocateFeeFixed(merchants, fee);
                if (!rows.length) {
                    warnings.push(`柜号 ${containerNo} 费用 ${fee.feeType} 固定费用需指定归属工厂/主体`);
                }
            }
            else if (method === 'by_ticket') {
                rows = allocateFeesByTicket(merchants, fee);
                if (!rows.length) {
                    warnings.push(`柜号 ${containerNo} 费用 ${fee.feeType} 无有效票数，已跳过`);
                }
            }
            else {
                rows = allocateFeesByVolume(merchants, fee);
                if (!rows.length) {
                    warnings.push(`柜号 ${containerNo} 费用 ${fee.feeType} 总体积为 0，已跳过`);
                }
            }
            if (shouldPadMerchantPlaceholders(fee, rows)) {
                rows = padMissingMerchantAllocations(merchants, fee, rows);
            }
            allocations.push(...rows);
        }
    }
    return { allocations, warnings };
}
export function reconcileAllocations(feeLines, allocations, pendingExceptions) {
    const warnings = [];
    const byBillItem = new Map();
    for (const row of allocations) {
        const key = row.sourceBillItemId;
        if (!byBillItem.has(key))
            byBillItem.set(key, []);
        byBillItem.get(key).push(row);
    }
    const containerChecks = [];
    let billTotalCny = 0;
    let allocationTotalCny = 0;
    for (const fee of feeLines) {
        if (fee.isException && (fee.exceptionStatus === 'pending' || fee.exceptionStatus === 'rejected')) {
            continue;
        }
        billTotalCny += fee.amountCny;
        const rows = byBillItem.get(fee.key) ?? [];
        const allocated = round2(rows.reduce((s, r) => s + r.allocatedAmountCny, 0));
        allocationTotalCny += allocated;
        const diff = round2(fee.amountCny - allocated);
        containerChecks.push({
            containerNo: fee.containerNo,
            feeType: fee.feeType,
            sourceBillType: fee.sourceBillType,
            sourceBillItemId: fee.key,
            sourceAmountCny: fee.amountCny,
            allocatedCny: allocated,
            diffCny: diff,
        });
        if (Math.abs(diff) > 0.01) {
            warnings.push(`柜 ${fee.containerNo} ${fee.feeType} 差额 ${diff.toFixed(2)} 元`);
        }
    }
    const diffCny = round2(billTotalCny - allocationTotalCny);
    return {
        billTotalCny: round2(billTotalCny),
        allocationTotalCny: round2(allocationTotalCny),
        diffCny,
        containerChecks,
        pendingExceptions,
        warnings,
        balanced: Math.abs(diffCny) <= 0.01 && warnings.length === 0,
    };
}
export function summarizeByMerchant(allocations) {
    const map = new Map();
    for (const row of allocations) {
        if (!map.has(row.merchantCode)) {
            map.set(row.merchantCode, {
                merchantCode: row.merchantCode,
                merchantName: row.merchantName,
                truckingTotal: 0,
                freightTotal: 0,
                customsTotal: 0,
                otherTotal: 0,
                grandTotal: 0,
            });
        }
        const s = map.get(row.merchantCode);
        if (!s.merchantName && row.merchantName)
            s.merchantName = row.merchantName;
        if (row.stage === 'trucking')
            s.truckingTotal += row.allocatedAmountCny;
        else if (row.stage === 'freight')
            s.freightTotal += row.allocatedAmountCny;
        else if (row.stage === 'customs')
            s.customsTotal += row.allocatedAmountCny;
        else
            s.otherTotal += row.allocatedAmountCny;
        s.grandTotal += row.allocatedAmountCny;
    }
    return [...map.values()].map((s) => ({
        ...s,
        truckingTotal: round2(s.truckingTotal),
        freightTotal: round2(s.freightTotal),
        customsTotal: round2(s.customsTotal),
        otherTotal: round2(s.otherTotal),
        grandTotal: round2(s.grandTotal),
    }));
}
function splitAmount(merchants, fee, totalBase, getBase, build) {
    const ratioRows = merchants.map((m) => ({
        merchant: m,
        ratio: getBase(m) / totalBase,
    }));
    let allocatedSum = 0;
    return ratioRows.map((entry, idx) => {
        const isLast = idx === ratioRows.length - 1;
        const amount = isLast ? round2(fee.amountCny - allocatedSum) : round2(fee.amountCny * entry.ratio);
        if (!isLast)
            allocatedSum += amount;
        return {
            containerNo: fee.containerNo,
            merchantCode: entry.merchant.merchantCode,
            merchantName: entry.merchant.merchantName,
            stage: fee.stage,
            feeType: fee.feeType,
            sourceBillType: fee.sourceBillType,
            sourceBillItemId: fee.key,
            sourceRef: fee.sourceRef,
            allocationMethod: fee.allocationMethod,
            sourceAmountCny: fee.amountCny,
            ...build(entry.merchant, entry.ratio, amount, isLast),
        };
    });
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
function round6(n) {
    return Math.round(n * 1_000_000) / 1_000_000;
}
