import { defineRuleModule } from '../core/define.js';
import { REPLENISHMENT_PARAMS } from './params.js';

export const replenishmentRule = defineRuleModule({
  code: 'replenishment',
  name: '备货规则',
  description: '决定要不要下单、下多少、何时下单',
  version: 1,
  params: REPLENISHMENT_PARAMS,
  scopes: ['global', 'project_group', 'warehouse'],
});

export * from './params.js';
export * from './qty.js';
export * from './evaluate.js';
