import { defaultsOf, type ParamSchema, type ParamValues } from '../core/param.js';

export const REPLENISHMENT_PARAMS = {
  singleCoverDays: {
    kind: 'int',
    label: '单次补货覆盖天数',
    unit: '天',
    default: 30,
    min: 7,
    max: 180,
    help: '单次建议量不超过从今天起该天数的规划需求；有缺口时再按 MOQ 抬升',
  },
  defaultSafetyStockDays: {
    kind: 'int',
    label: '默认安全库存天数',
    unit: '天',
    default: 14,
    min: 0,
    max: 180,
    help: '安全库存配置未填天数时使用',
  },
  overstockThresholdDays: {
    kind: 'int',
    label: '超储阈值',
    unit: '天',
    default: 180,
    min: 30,
    max: 720,
    help: '确定覆盖天数超过该值且无建议量时判蓝灯',
  },
  slowMovingDailyMax: {
    kind: 'number',
    label: '滞销日均上限',
    unit: '件/天',
    default: 0.1,
    min: 0,
    max: 10,
    help: '日均不超过该值且覆盖达到滞销覆盖下限时判灰灯，不出建议',
  },
  slowMovingMinCoverageDays: {
    kind: 'int',
    label: '滞销覆盖下限',
    unit: '天',
    default: 90,
    min: 0,
    max: 720,
  },
  moqPriority: {
    kind: 'enum',
    label: 'MOQ 取值顺序',
    default: 'sku_then_spu',
    options: [
      { value: 'sku_then_spu', label: 'SKU 优先，其次 SPU' },
      { value: 'spu_then_sku', label: 'SPU 优先，其次 SKU' },
      { value: 'max', label: '取两者较大值' },
    ],
  },
  yellowLightLinkage: {
    kind: 'boolean',
    label: '黄灯联动',
    default: true,
    help: '开：补货灯黄灯 SKU 仅在同 SPU 有红灯 SKU 需补时才补；关：黄灯与红灯一样需要即补',
  },
  usNetworkDeferEnabled: {
    kind: 'boolean',
    label: 'US 仓网延后',
    default: true,
    help: '开：US 单仓低于 ROP 但仓网总量足够时延后补货',
  },
} satisfies ParamSchema;

export type ReplenishmentParams = ParamValues<typeof REPLENISHMENT_PARAMS>;

export const REPLENISHMENT_DEFAULTS: ReplenishmentParams = defaultsOf(REPLENISHMENT_PARAMS);
