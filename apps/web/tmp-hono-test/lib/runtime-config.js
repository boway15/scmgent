import { isDifyEnabled, isReplenishmentWorkflowEnabled, isAlertWorkflowEnabled } from '../integrations/dify.js';
import { isDevAuthMode } from '../integrations/feishu-auth.js';
export function getRuntimeConfigSummary() {
    const authDevMode = isDevAuthMode();
    const rbacEnabled = process.env.ENFORCE_RBAC !== 'false';
    const serveStatic = process.env.SERVE_STATIC === 'true';
    const cronSecretConfigured = !!process.env.CRON_SECRET?.trim();
    const feishuConfigured = !!(process.env.FEISHU_APP_ID?.trim() && process.env.FEISHU_APP_SECRET?.trim());
    const warnings = [];
    if (authDevMode)
        warnings.push('AUTH_DEV_MODE=true：当前为开发免登录模式，不适合生产');
    if (serveStatic)
        warnings.push('SERVE_STATIC=true：妙搭生产建议设为 false');
    if (!cronSecretConfigured)
        warnings.push('CRON_SECRET 未配置：定时任务无法安全触发');
    if (!feishuConfigured)
        warnings.push('飞书 OAuth 未配置：生产登录需配置 FEISHU_APP_ID/SECRET');
    const productionReady = !authDevMode && !serveStatic && cronSecretConfigured;
    return {
        authDevMode,
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
