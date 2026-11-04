/** Server-side policy for the `/lab-proxy/$` relay (see routes/lab-proxy.$.ts).
 *
 * The relay must never become an open proxy, so:
 * - it only forwards to bridge origins configured on the server
 *   (`NOESIS_LAB_ORIGINS`, comma-separated). In development, when nothing is
 *   configured, the local bridge `http://127.0.0.1:8765` / `http://localhost:8765`
 *   is allowed; in production nothing is allowed until an origin is configured;
 * - it refuses upstream redirects (they could point at another origin);
 * - writes (start a run, answer an approval) depend on the write mode:
 *   - `open` (development): allowed, for the local bridge on this machine;
 *   - `disabled` (production without `NOESIS_LAB_WRITE_TOKEN`): the hosted app
 *     is read-only;
 *   - `operator` (production with a token): an operator signs in once by typing
 *     the token; the server checks it and sets a signed, HttpOnly,
 *     SameSite=Strict session cookie. Page code never sees or stores the
 *     token, and none ships in the frontend bundle. Cookie-authorised writes
 *     must also come from this app's own origin. Scripts may instead send the
 *     token in the `x-noesis-lab-token` header.
 */

export type ProxyEnv = Record<string, string | undefined>;
export type WriteMode = 'open' | 'operator' | 'disabled';

const DEV_DEFAULT_ORIGINS = ['http://127.0.0.1:8765', 'http://localhost:8765'];
export const WRITE_TOKEN_HEADER = 'x-noesis-lab-token';
export const SESSION_COOKIE = 'noesis_lab_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_TOKEN_LENGTH = 512;

export function isProduction(env: ProxyEnv): boolean {
  return env['NODE_ENV'] === 'production';
}

export function writeMode(env: ProxyEnv): WriteMode {
  if (!isProduction(env)) return 'open';
  return env['NOESIS_LAB_WRITE_TOKEN'] ? 'operator' : 'disabled';
}

export function allowedOrigins(env: ProxyEnv): Set<string> {
  const configured = (env['NOESIS_LAB_ORIGINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? [u.origin] : [];
      } catch {
        return [];
      }
    });
  if (configured.length) return new Set(configured);
  return new Set(isProduction(env) ? [] : DEV_DEFAULT_ORIGINS);
}

function deny(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, details: {} } }, { status });
}

/** The upstream URL for `path` on the requested bridge, or a refusal. */
export function resolveTarget(requestUrl: string, path: string, env: ProxyEnv): URL | Response {
  const url = new URL(requestUrl);
  let base: URL;
  try {
    base = new URL(url.searchParams.get('target') ?? '');
  } catch {
    return deny(400, 'invalid_lab_address', 'Invalid lab address');
  }
  if ((base.protocol !== 'https:' && base.protocol !== 'http:') || base.username || base.password) {
    return deny(400, 'invalid_lab_address', 'Invalid lab address');
  }
  if (!allowedOrigins(env).has(base.origin)) {
    return deny(403, 'lab_origin_not_allowed',
      `This server only relays to configured lab bridges (NOESIS_LAB_ORIGINS); ${base.origin} is not one of them`);
  }
  url.searchParams.delete('target');
  const upstream = new URL(`${base.pathname.replace(/\/$/, '')}/lab/${path}`, base.origin);
  upstream.search = url.searchParams.toString();
  if (upstream.origin !== base.origin) return deny(400, 'invalid_lab_address', 'Invalid lab address');
  return upstream;
}

const READ_ONLY_MESSAGE =
  'This hosted Noesis is read-only: recorded runs can be explored, but runs can only be started from a local lab (no operator token is configured on this server)';

/** Writes are open in development. In production they need an operator session
 * (or, for scripts, the token header), and are disabled when no token is configured. */
export async function checkWriteAllowed(request: Request, env: ProxyEnv, nowMs = Date.now()): Promise<Response | null> {
  const mode = writeMode(env);
  if (mode === 'open') return null;
  if (mode === 'disabled') return deny(403, 'writes_disabled', READ_ONLY_MESSAGE);
  const given = request.headers.get(WRITE_TOKEN_HEADER);
  if (given !== null) {
    return timingSafeEqual(given, env['NOESIS_LAB_WRITE_TOKEN']!) ? null : deny(401, 'unauthorized', 'Invalid lab write token');
  }
  if (!(await verifySession(readCookie(request.headers, SESSION_COOKIE), env, nowMs))) {
    return deny(401, 'operator_session_required', 'Starting runs on this hosted app needs an operator session. Unlock runs with the operator token first.');
  }
  if (!isSameOrigin(request, env)) return deny(403, 'cross_site_write', 'Lab writes must come from this app');
  return null;
}

/* ------------------------------------------------------- operator session */

export type SessionStatus = { write_mode: WriteMode; signed_in: boolean };

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message))));
}

const sessionMessage = (exp: number) => `noesis-lab-session:v1:${exp}`;

/** A session value `<expiry>.<HMAC(token, expiry)>`. It holds no secret, and rotating
 * the token invalidates every session. */
export async function issueSession(env: ProxyEnv, nowMs = Date.now()): Promise<string> {
  const token = env['NOESIS_LAB_WRITE_TOKEN'];
  if (!token) throw new Error('no operator token configured');
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  return `${exp}.${await hmac(token, sessionMessage(exp))}`;
}

export async function verifySession(value: string | null, env: ProxyEnv, nowMs = Date.now()): Promise<boolean> {
  const token = env['NOESIS_LAB_WRITE_TOKEN'];
  if (!token || !value) return false;
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return false;
  const exp = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  if (exp <= now || exp > now + SESSION_TTL_SECONDS + 60) return false;
  return timingSafeEqual(match[2] ?? '', await hmac(token, sessionMessage(exp)));
}

export function readCookie(headers: Headers, name: string): string | null {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionCookie(value: string, maxAge: number, env: ProxyEnv): string {
  const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/lab-proxy', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (isProduction(env)) attrs.push('Secure');
  return attrs.join('; ');
}

/** The request comes from this app's own pages. `NOESIS_PUBLIC_ORIGIN` names the
 * public origin when a reverse proxy changes the URL the server sees. */
export function isSameOrigin(request: Request, env: ProxyEnv): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    const own = new Set([new URL(request.url).origin]);
    const pub = env['NOESIS_PUBLIC_ORIGIN'];
    if (pub) {
      try { own.add(new URL(pub).origin); } catch { /* ignore a malformed setting */ }
    }
    return own.has(origin);
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function sessionJson(body: SessionStatus, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  if (cookie) headers.set('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

/** GET /lab-proxy/session: how writes work here, and whether this browser may write. */
export async function sessionStatus(request: Request, env: ProxyEnv, nowMs = Date.now()): Promise<Response> {
  const mode = writeMode(env);
  const signedIn = mode === 'open' || (mode === 'operator' && await verifySession(readCookie(request.headers, SESSION_COOKIE), env, nowMs));
  return sessionJson({ write_mode: mode, signed_in: signedIn });
}

/** POST /lab-proxy/session {token}: exchange the operator token for a session cookie. */
export async function signIn(request: Request, env: ProxyEnv, nowMs = Date.now()): Promise<Response> {
  const mode = writeMode(env);
  if (mode === 'open') return sessionJson({ write_mode: mode, signed_in: true });
  if (mode === 'disabled') return deny(403, 'writes_disabled', READ_ONLY_MESSAGE);
  if (!isSameOrigin(request, env)) return deny(403, 'cross_site_write', 'Sign in from this app');
  let token: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_TOKEN_LENGTH + 64) return deny(413, 'too_large', 'Request too large');
    token = (JSON.parse(raw) as { token?: unknown }).token;
  } catch {
    return deny(400, 'invalid_body', 'Expected {"token": "..."}');
  }
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH || !timingSafeEqual(token, env['NOESIS_LAB_WRITE_TOKEN']!)) {
    return deny(401, 'unauthorized', 'That operator token is not valid');
  }
  return sessionJson({ write_mode: mode, signed_in: true }, 200, sessionCookie(await issueSession(env, nowMs), SESSION_TTL_SECONDS, env));
}

/** DELETE /lab-proxy/session: end this browser's operator session. */
export function signOut(env: ProxyEnv): Response {
  const mode = writeMode(env);
  return sessionJson({ write_mode: mode, signed_in: mode === 'open' }, 200, sessionCookie('', 0, env));
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** fetch() that never follows redirects: a 3xx from the bridge is refused, not chased. */
export async function relayFetch(upstream: URL, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const res = await fetchImpl(upstream, { ...init, redirect: 'manual' });
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    return deny(502, 'lab_redirect_refused', 'The lab bridge answered with a redirect; redirects are not followed');
  }
  return res;
}

/** The settings the proxy sees. Two rules keep a hosted app from failing open:
 * - Development vs production comes from the build (`vite dev` vs `vite build`), never
 *   from a runtime variable. Cloudflare Workers set no NODE_ENV, and a deployment that
 *   forgot it must not count as development (open writes, local default origins).
 * - Settings are read from Cloudflare bindings (`globalThis.__env__`, string values
 *   only) and from `process.env`, so they work on Workers and on Node. */
export function buildServerEnv(processEnv: ProxyEnv, bindings: Record<string, unknown>, devBuild: boolean): ProxyEnv {
  const env: ProxyEnv = {};
  for (const [k, v] of Object.entries(bindings)) if (typeof v === 'string') env[k] = v;
  Object.assign(env, processEnv);
  env['NODE_ENV'] = devBuild ? 'development' : 'production';
  return env;
}

export function serverEnv(): ProxyEnv {
  const g = globalThis as { process?: { env?: ProxyEnv }; __env__?: Record<string, unknown> };
  return buildServerEnv(g.process?.env ?? {}, g.__env__ ?? {}, import.meta.env.DEV === true);
}
