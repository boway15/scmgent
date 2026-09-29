export const PRODUCT_SCOPE_HINT =
  '配件不参与销量、预测与备货，默认已排除。需要核对配件时，切换到「只看配件」。';

export const DEMAND_PLAN_SCOPE_NOTICE =
  '本页一律不含配件。配件（编码变化段含 P，或主数据标记为配件）不参与备货，需求计划不生成、不展示配件 SKU。要看配件库存或销量，请到库存查询或销量历史，切换到「只看配件」。';

export const DEMAND_PLAN_GENERATE_HINT = '生成时自动跳过配件 SKU，草稿里不会出现配件。';

export const FORECAST_EMPTY_EXCLUDED =
  '本版预测生成时已排除配件，所以这里没有配件行。若要单独看配件预测，请重新生成并取消「不含配件」。';

export const ANALYTICS_SCOPE_PENDING =
  '当前快照尚未按配件拆分，请重新生成分析立方；在此之前「不含配件」仍包含生成时的配件销量。';
