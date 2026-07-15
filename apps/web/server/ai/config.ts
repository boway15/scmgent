import { getDifyConfigSummary } from '../integrations/dify.js';

export type AiRuntimeConfig = {
  difyEnabled: boolean;
  replenishmentWorkflow: boolean;
  alertWorkflow: boolean;
  salesForecastWorkflow: boolean;
  baseUrl: string;
};

export function getAiRuntimeConfig(): AiRuntimeConfig {
  const dify = getDifyConfigSummary();

  return {
    difyEnabled: dify.difyEnabled,
    replenishmentWorkflow: dify.replenishmentWorkflow,
    alertWorkflow: dify.alertWorkflow,
    salesForecastWorkflow: dify.salesForecastWorkflow,
    baseUrl: dify.baseUrl,
  };
}

export function getAiConfigSummary() {
  const cfg = getAiRuntimeConfig();
  return {
    mode: cfg.difyEnabled ? ('dify' as const) : ('local' as const),
    difyEnabled: cfg.difyEnabled,
    replenishmentWorkflow: cfg.replenishmentWorkflow,
    alertWorkflow: cfg.alertWorkflow,
    salesForecastWorkflow: cfg.salesForecastWorkflow,
    baseUrl: cfg.baseUrl,
  };
}
