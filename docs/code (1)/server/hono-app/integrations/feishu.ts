const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getTenantAccessToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

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
    throw new Error(`Feishu auth failed: ${data.msg}`);
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
