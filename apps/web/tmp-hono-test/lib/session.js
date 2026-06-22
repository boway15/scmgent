import { sign, verify } from 'hono/jwt';
const COOKIE_NAME = 'scm_session';
const MAX_AGE_SEC = 7 * 24 * 60 * 60;
function getSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret === 'change-me') {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('JWT_SECRET must be set in production');
        }
        return 'dev-jwt-secret-scm-agent';
    }
    return secret;
}
export async function createSessionToken(payload) {
    const now = Math.floor(Date.now() / 1000);
    return sign({ ...payload, iat: now, exp: now + MAX_AGE_SEC }, getSecret(), 'HS256');
}
export async function verifySessionToken(token) {
    try {
        const payload = await verify(token, getSecret(), 'HS256');
        return {
            sub: payload.sub,
            email: payload.email,
            roleCode: payload.roleCode,
        };
    }
    catch {
        return null;
    }
}
export { COOKIE_NAME, MAX_AGE_SEC };
