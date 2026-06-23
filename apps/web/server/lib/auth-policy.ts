function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

/** Emergency debug only: skip login and auto-use admin@scm.local */
export function isAuthBypassLogin(): boolean {
  if (envBool('AUTH_BYPASS_LOGIN', false)) return true;
  // Legacy alias; prefer AUTH_BYPASS_LOGIN
  return envBool('AUTH_DEV_MODE', false);
}

/** All environments require session login unless AUTH_BYPASS_LOGIN is set */
export function isAuthRequired(): boolean {
  return !isAuthBypassLogin();
}

/** Email register / login available */
export function isEmailAuthEnabled(): boolean {
  if (!isAuthRequired()) return false;
  return envBool('EMAIL_AUTH_ENABLED', true);
}

/** Feishu OAuth explicitly enabled via env (still needs app credentials) */
export function isFeishuAuthEnabledFlag(): boolean {
  return envBool('FEISHU_AUTH_ENABLED', false);
}

export function isFeishuCredentialsConfigured(): boolean {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  return !!(appId && appSecret);
}

/** Feishu login button + callback */
export function isFeishuLoginAvailable(): boolean {
  if (!isAuthRequired()) return false;
  if (!isFeishuAuthEnabledFlag()) return false;
  return isFeishuCredentialsConfigured();
}

/** @deprecated Use isAuthBypassLogin */
export function isDevAuthMode(): boolean {
  return isAuthBypassLogin();
}
