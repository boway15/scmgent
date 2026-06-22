import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes } from 'crypto';
import { buildFeishuAuthorizeUrl, exchangeCodeForUser, isDevAuthMode, isFeishuAuthEnabled, } from '../integrations/feishu-auth.js';
import { COOKIE_NAME, MAX_AGE_SEC, createSessionToken, } from '../lib/session.js';
import { findOrCreateFeishuUser, getCurrentUser } from '../lib/auth-context.js';
export const authRoutes = new Hono();
authRoutes.get('/auth/config', (c) => c.json({
    feishuEnabled: isFeishuAuthEnabled(),
    devMode: isDevAuthMode(),
}));
authRoutes.get('/auth/feishu/url', (c) => {
    if (!isFeishuAuthEnabled()) {
        return c.json({ message: 'Feishu OAuth is not configured' }, 503);
    }
    const state = randomBytes(16).toString('hex');
    setCookie(c, 'oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 600,
        path: '/',
    });
    return c.json({ url: buildFeishuAuthorizeUrl(state) });
});
authRoutes.get('/auth/feishu/callback', async (c) => {
    if (!isFeishuAuthEnabled()) {
        return c.redirect('/login?error=feishu_not_configured');
    }
    const code = c.req.query('code');
    const state = c.req.query('state');
    const savedState = getCookie(c, 'oauth_state');
    if (!code || !state || state !== savedState) {
        return c.redirect('/login?error=invalid_oauth_state');
    }
    try {
        const feishuUser = await exchangeCodeForUser(code);
        const user = await findOrCreateFeishuUser(feishuUser);
        const token = await createSessionToken({
            sub: user.id,
            email: user.email,
            roleCode: user.role.code,
        });
        setCookie(c, COOKIE_NAME, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAge: MAX_AGE_SEC,
            path: '/',
        });
        deleteCookie(c, 'oauth_state', { path: '/' });
        return c.redirect('/');
    }
    catch (err) {
        console.error('[auth] Feishu callback error:', err);
        return c.redirect('/login?error=oauth_failed');
    }
});
authRoutes.post('/auth/logout', (c) => {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
});
authRoutes.get('/me', async (c) => {
    const user = await getCurrentUser(c);
    return c.json(user);
});
