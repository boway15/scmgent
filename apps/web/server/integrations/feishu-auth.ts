const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

export function isDevAuthMode(): boolean {
  return process.env.AUTH_DEV_MODE === 'true';
}

export function isFeishuAuthEnabled(): boolean {
  if (isDevAuthMode()) return false;
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  return !!(appId && appSecret);
}

export function getOAuthRedirectUri(): string {
  return (
    process.env.FEISHU_OAUTH_REDIRECT_URI ??
    `${process.env.APP_BASE_URL ?? 'http://localhost:8080'}/api/auth/feishu/callback`
  );
}

export function buildFeishuAuthorizeUrl(state: string): string {
  const appId = process.env.FEISHU_APP_ID!;
  const redirectUri = encodeURIComponent(getOAuthRedirectUri());
  return `https://passport.feishu.cn/suite/passport/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
}

async function getAppAccessToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID!;
  const appSecret = process.env.FEISHU_APP_SECRET!;

  const res = await fetch(`${FEISHU_BASE}/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const data = (await res.json()) as {
    code: number;
    app_access_token?: string;
    msg?: string;
  };

  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`Feishu app token failed: ${data.msg ?? res.statusText}`);
  }

  return data.app_access_token;
}

export type FeishuUserInfo = {
  openId: string;
  unionId?: string;
  name: string;
  email?: string;
  avatarUrl?: string;
};

export async function exchangeCodeForUser(code: string): Promise<FeishuUserInfo> {
  const appToken = await getAppAccessToken();

  const tokenRes = await fetch(`${FEISHU_BASE}/authen/v1/oidc/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  });

  const tokenData = (await tokenRes.json()) as {
    code: number;
    msg?: string;
    data?: { access_token?: string };
  };

  if (tokenData.code !== 0 || !tokenData.data?.access_token) {
    throw new Error(`Feishu token exchange failed: ${tokenData.msg ?? tokenRes.statusText}`);
  }

  const userRes = await fetch(`${FEISHU_BASE}/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${tokenData.data.access_token}` },
  });

  const userData = (await userRes.json()) as {
    code: number;
    msg?: string;
    data?: {
      open_id?: string;
      union_id?: string;
      name?: string;
      email?: string;
      avatar_url?: string;
    };
  };

  if (userData.code !== 0 || !userData.data?.open_id) {
    throw new Error(`Feishu user info failed: ${userData.msg ?? userRes.statusText}`);
  }

  return {
    openId: userData.data.open_id,
    unionId: userData.data.union_id,
    name: userData.data.name ?? '飞书用户',
    email: userData.data.email,
    avatarUrl: userData.data.avatar_url,
  };
}
