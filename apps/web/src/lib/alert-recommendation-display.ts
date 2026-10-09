/** 列表 / 导出共用的建议下单、建议发货展示字段。 */

export const RECOMMEND_EMPTY = '-';

export type RecommendationTriple = {
  yes: boolean;
  yesLabel: string;
  date: string;
  qty: string;
};

export function orderRecommendationFields(input: {
  orderWindowCovered?: boolean;
  orderOverseasReference?: boolean;
  orderQty?: number | null;
  orderByDate?: string | null;
  orderNow?: boolean;
}): RecommendationTriple {
  const qty = input.orderQty ?? 0;
  const yes =
    qty > 0 &&
    (input.orderOverseasReference || !(input.orderWindowCovered ?? false));
  return {
    yes,
    yesLabel: yes ? '是' : '否',
    date: yes ? formatRecommendDate(!!input.orderNow, input.orderByDate) : '',
    qty: formatRecommendQty(input.orderQty, yes),
  };
}

export function shipRecommendationFields(input: {
  shipWindowCovered?: boolean;
  shipQty?: number | null;
  shipByDate?: string | null;
  shipNow?: boolean;
}): RecommendationTriple {
  const yes = !(input.shipWindowCovered ?? false) && (input.shipQty ?? 0) > 0;
  return {
    yes,
    yesLabel: yes ? '是' : '否',
    date: yes ? formatRecommendDate(!!input.shipNow, input.shipByDate) : '',
    qty: formatRecommendQty(input.shipQty, yes),
  };
}

function formatRecommendDate(now: boolean, date: string | null | undefined): string {
  if (now || !date) return '立即';
  return date.slice(0, 10);
}

function formatRecommendQty(qty: number | null | undefined, active: boolean): string {
  if (!active || qty == null || !Number.isFinite(qty) || qty <= 0) return RECOMMEND_EMPTY;
  return Math.round(qty).toLocaleString('zh-CN');
}
