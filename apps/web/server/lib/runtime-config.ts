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
  jwtSecretConfigured: boolean;
  productionReady: boolean;
  warnings: string[];
};

function isWeakSecret(value: string | undefined, minLength = 16): boolean {
  if (!value?.trim()) return true;
  const v = value.trim();
  if (v.length < minLength) return true;
  const weak = ['dev-secret', 'change-me', 'jwt-secret', 'cron-secret', 'your-secret'];
  return weak.some((w) => v.toLowerCase().includes(w));
}

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
  const jwtSecretConfigured = !!process.env.JWT_SECRET?.trim();
  const isProd = process.env.NODE_ENV === 'production';

  const warnings: string[] = [];
  if (authBypass) warnings.push('AUTH_BYPASS_LOGIN=true：当前跳过登录，仅用于紧急调试');
  if (serveStatic) warnings.push('SERVE_STATIC=true：生产建议设为 false');
  if (!cronSecretConfigured) warnings.push('CRON_SECRET 未配置：定时任务无法安全触发');
  if (isWeakSecret(process.env.CRON_SECRET)) warnings.push('CRON_SECRET 过弱：请使用至少 16 位随机字符串');
  if (isWeakSecret(process.env.JWT_SECRET)) warnings.push('JWT_SECRET 过弱或未配置');
  if (authRequired && !emailAuthEnabled) warnings.push('EMAIL_AUTH_ENABLED=false：邮箱登录已关闭');
  if (feishuAuthEnabled && !feishuConfigured) {
    warnings.push('FEISHU_AUTH_ENABLED=true 但 FEISHU_APP_ID/SECRET 未配置');
  }
  if (authRequired && !feishuLoginAvailable && !emailAuthEnabled) {
    warnings.push('无可用登录方式：请启用邮箱或飞书登录');
  }
  if (isProd && authBypass) warnings.push('生产环境不应启用 AUTH_BYPASS_LOGIN');

  const productionReady =
    authRequired &&
    !authBypass &&
    !serveStatic &&
    cronSecretConfigured &&
    jwtSecretConfigured &&
    !isWeakSecret(process.env.JWT_SECRET) &&
    !isWeakSecret(process.env.CRON_SECRET) &&
    (emailAuthEnabled || feishuLoginAvailable);

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
    jwtSecretConfigured,
    productionReady,
    warnings,
  };
}
