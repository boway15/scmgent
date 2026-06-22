/** 妙搭子路径：构建时 CLIENT_BASE_PATH；若构建时无则从当前 URL 推断 */
export function appBasePath(): string {
  const fromBuild = (process.env.CLIENT_BASE_PATH || '').replace(/\/$/, '');
  if (fromBuild && fromBuild !== '/') return fromBuild;
  return detectBasePathFromLocation();
}

function detectBasePathFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^(\/app\/app_[^/]+)/);
  return match?.[1] ?? '';
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = appBasePath();
  return base ? `${base}${normalized}` : normalized;
}

/** 妙搭 CSRF：cookie suda-csrf-token → header x-suda-csrf-token */
const CSRF_COOKIE = 'suda-csrf-token';
const CSRF_HEADER = 'x-suda-csrf-token';

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  const raw = match?.[1];
  return raw ? decodeURIComponent(raw) : undefined;
}

/** 带 credentials + 妙搭 CSRF 的 fetch（本地无 cookie 时不加 header） */
export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) headers.set(CSRF_HEADER, csrf);
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, {
    credentials: 'include',
    ...init,
    headers,
  });
}
