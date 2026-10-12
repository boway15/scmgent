import { buildContainerOriginPortMap } from './fob-fee-rules.js';

/** 与 fob-batch-helpers 的 FOB_NON_FOB_MARKER 一致，避免本模块依赖数据库 */
const NON_FOB_MARKER = '__NON_FOB__';

export type FreightPortIssueGroup = {
  portName: string;
  containerCount: number;
};

export type FreightBillPortReadiness = {
  ok: boolean;
  unregistered: FreightPortIssueGroup[];
  noRules: FreightPortIssueGroup[];
  missingPortContainers: string[];
  conflictContainers: string[];
  blockers: string[];
};

type VolumePortRow = {
  containerNo: string;
  originPort?: string | null;
  merchantCode?: string;
};

function uniqueContainers(rows: VolumePortRow[]): string[] {
  return [...new Set(rows.map((row) => row.containerNo).filter(Boolean))].sort();
}

function previewContainers(containers: string[], limit = 5): string {
  const shown = containers.slice(0, limit).join('、');
  const suffix = containers.length > limit ? ` 等 ${containers.length} 个` : '';
  return `${shown}${suffix}`;
}

function formatPortGroups(groups: FreightPortIssueGroup[], limit = 8): string {
  const shown = groups
    .slice(0, limit)
    .map((group) => `${group.portName}（${group.containerCount} 柜）`)
    .join('、');
  const suffix = groups.length > limit ? ` 等 ${groups.length} 个港口` : '';
  return `${shown}${suffix}`;
}

function groupByPort(entries: Array<{ portName: string; containerNo: string }>): FreightPortIssueGroup[] {
  const byPort = new Map<string, Set<string>>();
  for (const entry of entries) {
    const containers = byPort.get(entry.portName) ?? new Set<string>();
    containers.add(entry.containerNo);
    byPort.set(entry.portName, containers);
  }
  return [...byPort.entries()]
    .map(([portName, containers]) => ({ portName, containerCount: containers.size }))
    .sort((a, b) => a.portName.localeCompare(b.portName, 'zh-CN'));
}

/** 同柜只有一个起运港时，把空单元格补成该港，方便后续只按柜判断 */
export function fillFreightVolumeOriginPorts<T extends VolumePortRow>(items: T[]): T[] {
  const { byContainer, conflicts } = buildContainerOriginPortMap(items, {
    excludeNonFobMarker: NON_FOB_MARKER,
  });
  const conflictSet = new Set(conflicts);
  return items.map((item) => {
    if (conflictSet.has(item.containerNo)) return item;
    const portName = (item.originPort ?? '').trim() || byContainer.get(item.containerNo);
    return portName ? { ...item, originPort: portName } : item;
  });
}

/**
 * 体积导入说明。不拒绝未登记港口：截单清单里常有本批账单用不到的柜。
 * 没有「起运港」列时只给一句说明，避免按柜刷屏。
 */
export function summarizeFreightVolumeImport(input: {
  items: VolumePortRow[];
  originPortColumnFound: boolean;
  registeredPortNames: Iterable<string>;
}): string[] {
  if (!input.originPortColumnFound) {
    return [
      '表格没有「起运港」列，体积已导入。本批货代账单里的柜，核算前需要能对应到起运港。',
    ];
  }

  const registered = new Set([...input.registeredPortNames].map((name) => name.trim()).filter(Boolean));
  const { byContainer, conflicts } = buildContainerOriginPortMap(input.items, {
    excludeNonFobMarker: NON_FOB_MARKER,
  });
  const conflictSet = new Set(conflicts);
  const warnings: string[] = [];

  if (conflicts.length) {
    warnings.push(
      `有 ${conflicts.length} 个柜同一柜存在多个起运港（${previewContainers(conflicts)}）。若这些柜出现在货代账单中，核算前需要改成同一个港口。`,
    );
  }

  const missing: string[] = [];
  const unknownEntries: Array<{ portName: string; containerNo: string }> = [];
  for (const containerNo of uniqueContainers(input.items.filter((row) => row.merchantCode !== NON_FOB_MARKER))) {
    if (conflictSet.has(containerNo)) continue;
    const portName = byContainer.get(containerNo);
    if (!portName) {
      missing.push(containerNo);
      continue;
    }
    if (!registered.has(portName)) unknownEntries.push({ portName, containerNo });
  }

  const unknown = groupByPort(unknownEntries);
  if (unknown.length) {
    warnings.push(
      `体积中有未登记或已停用的起运港：${formatPortGroups(unknown)}。只有出现在本批货代账单中的柜，才需要建港并配置规则。`,
    );
  }
  if (missing.length) {
    warnings.push(
      `有 ${missing.length} 个柜未填写起运港（${previewContainers(missing)}）。若这些柜会出现在本批货代账单中，核算前需要补上。`,
    );
  }

  return warnings;
}

/**
 * 只检查同时出现在体积和货代账单中的柜。
 * 整港没有规则时拦住；港口已有规则但缺个别费用项，留给异常审核。
 */
export function assessFreightBillPortReadiness(input: {
  shipments: VolumePortRow[];
  matchedContainers: Iterable<string>;
  portNameToId: Map<string, string>;
  portIdsWithRules: Set<string>;
}): FreightBillPortReadiness {
  const matched = [...new Set(input.matchedContainers)].filter(Boolean).sort();
  const { byContainer, conflicts } = buildContainerOriginPortMap(input.shipments, {
    excludeNonFobMarker: NON_FOB_MARKER,
  });
  const conflictSet = new Set(conflicts);

  const conflictContainers: string[] = [];
  const missingPortContainers: string[] = [];
  const unregisteredEntries: Array<{ portName: string; containerNo: string }> = [];
  const noRuleEntries: Array<{ portName: string; containerNo: string }> = [];

  for (const containerNo of matched) {
    if (conflictSet.has(containerNo)) {
      conflictContainers.push(containerNo);
      continue;
    }
    const portName = byContainer.get(containerNo);
    if (!portName) {
      missingPortContainers.push(containerNo);
      continue;
    }
    const portId = input.portNameToId.get(portName);
    if (!portId) {
      unregisteredEntries.push({ portName, containerNo });
      continue;
    }
    if (!input.portIdsWithRules.has(portId)) {
      noRuleEntries.push({ portName, containerNo });
    }
  }

  const unregistered = groupByPort(unregisteredEntries);
  const noRules = groupByPort(noRuleEntries);
  const blockers: string[] = [];

  if (conflictContainers.length) {
    blockers.push(
      `账单中有 ${conflictContainers.length} 个柜存在多个起运港（${previewContainers(conflictContainers)}）。请把同一柜改成一个起运港后再核算。`,
    );
  }
  if (missingPortContainers.length) {
    blockers.push(
      `账单中有 ${missingPortContainers.length} 个柜缺少起运港（${previewContainers(missingPortContainers)}）。请在体积文件补上「起运港」后重新导入，名称须与费用规则中的港口完全一致。`,
    );
  }
  if (unregistered.length) {
    blockers.push(
      `账单用到的起运港未登记或已停用：${formatPortGroups(unregistered)}。请到费用规则中按体积表格里的名称建港，并从「模板港口」复制规则。体积文件里其余港口不用处理。`,
    );
  }
  if (noRules.length) {
    blockers.push(
      `账单用到的起运港还没有货代规则：${formatPortGroups(noRules)}。请从「模板港口」复制规则到这些港口后再核算。`,
    );
  }

  return {
    ok: blockers.length === 0,
    unregistered,
    noRules,
    missingPortContainers,
    conflictContainers,
    blockers,
  };
}

export function freightPortIdsWithRules(
  rules: Array<{ sourceBillType: string; portId?: string | null }>,
): Set<string> {
  return new Set(
    rules
      .filter((rule) => rule.sourceBillType === 'freight' && rule.portId)
      .map((rule) => rule.portId as string),
  );
}
