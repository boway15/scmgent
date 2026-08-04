const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

let cachedToken: { token: string; expiresAt: number } | null = null;

function looksLikePlaceholderCredential(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return /^(cli_)?x{4,}|your_|change-?me|placeholder|example|todo/i.test(v);
}

function formatFeishuAuthError(msg: string | undefined, appId: string, appSecret: string): string {
  const detail = msg?.trim() || 'unknown';
  if (detail.toLowerCase().includes('invalid param')) {
    const hints: string[] = [];
    if (looksLikePlaceholderCredential(appId)) {
      hints.push('FEISHU_APP_ID 仍为占位符或未填');
    }
    if (looksLikePlaceholderCredential(appSecret)) {
      hints.push('FEISHU_APP_SECRET 仍为占位符或未填');
    }
    if (hints.length) {
      return `Feishu auth failed: ${detail}（${hints.join('；')}）。请在飞书开放平台创建自建应用，复制 App ID（cli_ 开头）与 App Secret 到 .env，重建 web 容器。多维表格 app_token 不能替代这两项。`;
    }
    return `Feishu auth failed: ${detail}。请核对 .env 中 FEISHU_APP_ID / FEISHU_APP_SECRET 是否与飞书开放平台一致，并确认应用已开通「多维表格」权限且已加入目标 Base 协作者。`;
  }
  return `Feishu auth failed: ${detail}`;
}

export async function getTenantAccessToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET are required');
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const data = (await res.json()) as {
    code: number;
    tenant_access_token?: string;
    expire?: number;
    msg?: string;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(formatFeishuAuthError(data.msg, appId, appSecret));
  }

  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire ?? 7200) * 1000 - 60_000,
  };

  return cachedToken.token;
}

export async function sendFeishuGroupMessage(text: string): Promise<void> {
  const chatId = process.env.FEISHU_ALERT_CHAT_ID;
  if (!chatId) {
    console.warn('[feishu] FEISHU_ALERT_CHAT_ID not set, skipping message push');
    return;
  }

  const token = await getTenantAccessToken();

  const res = await fetch(`${FEISHU_BASE}/im/v1/messages?receive_id_type=chat_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Feishu message failed ${res.status}: ${body}`);
  }
}
