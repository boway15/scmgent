import { isDifyEnabled, isReplenishmentWorkflowEnabled, isAlertWorkflowEnabled } from '../integrations/dify.js';
import {
  isAuthBypassLogin,
  isAuthRequired,
  isEmailAuthEnabled,
  isFeishuAuthEnabledFlag,
  isFeishuCredentialsConfigured,
  isFeishuLoginAvailable,
} from '../lib/auth-policy.js';

export type RuntimeConfigSummary = {
  authBypass: boolean;
  authRequired: boolean;
  emailAuthEnabled: boolean;
  feishuAuthEnabled: boolean;
  feishuLoginAvailable: boolean;
  rbacEnabled: boolean;
  serveStatic: boolean;
  difyEnabled: boolean;
  replenishmentWorkflow: boolean;
  alertWorkflow: boolean;
  cronSecretConfigured: boolean;
  feishuConfigured: boolean;
  productionReady: boolean;
  warnings: string[];
};

export function getRuntimeConfigSummary(): RuntimeConfigSummary {
  const authBypass = isAuthBypassLogin();
  const authRequired = isAuthRequired();
  const emailAuthEnabled = isEmailAuthEnabled();
  const feishuAuthEnabled = isFeishuAuthEnabledFlag();
  const feishuLoginAvailable = isFeishuLoginAvailable();
  const rbacEnabled = process.env.ENFORCE_RBAC !== 'false';
  const serveStatic = process.env.SERVE_STATIC === 'true';
  const cronSecretConfigured = !!process.env.CRON_SECRET?.trim();
  const feishuConfigured = isFeishuCredentialsConfigured();

  const warnings: string[] = [];
  if (authBypass) warnings.push('AUTH_BYPASS_LOGIN=true：当前跳过登录，仅用于紧急调试');
  if (serveStatic) warnings.push('SERVE_STATIC=true：妙搭生产建议设为 false');
  if (!cronSecretConfigured) warnings.push('CRON_SECRET 未配置：定时任务无法安全触发');
  if (authRequired && !emailAuthEnabled) warnings.push('EMAIL_AUTH_ENABLED=false：邮箱登录已关闭');
  if (feishuAuthEnabled && !feishuConfigured) {
    warnings.push('FEISHU_AUTH_ENABLED=true 但 FEISHU_APP_ID/SECRET 未配置');
  }
  if (authRequired && !feishuLoginAvailable && !emailAuthEnabled) {
    warnings.push('无可用登录方式：请启用邮箱或飞书登录');
  }

  const productionReady =
    authRequired && emailAuthEnabled && !authBypass && !serveStatic && cronSecretConfigured;

  return {
    authBypass,
    authRequired,
    emailAuthEnabled,
    feishuAuthEnabled,
    feishuLoginAvailable,
    rbacEnabled,
    serveStatic,
    difyEnabled: isDifyEnabled(),
    replenishmentWorkflow: isReplenishmentWorkflowEnabled(),
    alertWorkflow: isAlertWorkflowEnabled(),
    cronSecretConfigured,
    feishuConfigured,
    productionReady,
    warnings,
  };
}
