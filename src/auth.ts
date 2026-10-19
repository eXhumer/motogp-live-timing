import { request, type Dispatcher } from 'undici';

import { TIMINGPASS_URL } from './ondemand.js';

/** MotoGP account token endpoint (OAuth password and refresh token grants). */
export const LOGIN_URL = 'https://api.motogp.com/login/token';
/** Client id the motogp.com login page uses; it is also the access token's audience. */
export const LOGIN_CLIENT_ID = 'b32ca14f-0709-495a-9184-8bd848cf7e6b';
/** The motogp.com web client the login page signs in on behalf of. */
export const ORIGIN_CLIENT_ID = 'b4b18243-76dd-4d76-a58e-458cff85dba3';
/** The account's active licences (subscriptions). */
export const PERMISSIONS_URL = 'https://api.motogp.com/perms/me?active=true';
/**
 * Last known Timing Pass licence id. {@link timingPassLicenceId} reads the
 * current one from the timingpass site and only falls back to this.
 */
export const TIMING_PASS_LICENCE_ID = '65028c47-0994-432b-a300-ffdcc97447c1';

interface TokenRequestOptions {
  /** Default {@link LOGIN_URL}. */
  readonly url?: string;
  readonly dispatcher?: Dispatcher;
  /** Extra headers, such as a browser `user-agent`. */
  readonly headers?: Record<string, string>;
}

export interface LoginOptions extends TokenRequestOptions {
  readonly username: string;
  readonly password: string;
}

export interface RefreshTokenOptions extends TokenRequestOptions {
  /** The `DRT` cookie, or `refresh_token` from {@link login} or the previous refresh (it rotates). */
  readonly refreshToken: string;
}

export interface TokenResponse {
  token_type: string;
  /** Seconds (about 31 days). */
  expires_in: number;
  /** The `DAT` cookie: pass it as `token` to the clients. */
  access_token: string;
  /** The `DRT` cookie (valid for about 4 months). */
  refresh_token: string;
  issued_token_type: string | null;
}

/** The token endpoint refused a login or refresh. `body` holds its answer, e.g. `invalid_grant`. */
export class LoginError extends Error {
  override readonly name = 'LoginError';
  constructor(readonly statusCode: number, readonly body: string, action: string) {
    super(`MotoGP ${action} failed (HTTP ${statusCode}).`);
  }
}

/**
 * Sign in to a MotoGP account the way the motogp.com login page does. The
 * site sits behind Imperva, which may challenge requests that do not look
 * like a browser; when that happens, copy the `DAT` cookie from a browser
 * instead.
 */
export function login(options: LoginOptions): Promise<TokenResponse> {
  return tokenRequest(options, 'login', {
    grant_type: 'password',
    client_id: LOGIN_CLIENT_ID,
    username: options.username,
    password: options.password,
    origin_client_id: ORIGIN_CLIENT_ID,
  });
}

/**
 * Exchange a refresh token (`DRT`) for a new access token, with the OAuth
 * `refresh_token` grant. The answer has the same shape as {@link login}'s: a
 * fresh 31-day access token with the same account and entitlements.
 *
 * The refresh token rotates: every refresh returns a new `refresh_token`.
 * Store it in place of the old one. An unknown or used-up token is refused
 * with `invalid_grant` ("The refresh token is invalid.").
 *
 * The timingpass web app refreshes through its own `POST /api/sso/refresh`
 * route instead, which reads the `DRT` cookie and does this server side.
 */
export function refreshToken(options: RefreshTokenOptions): Promise<TokenResponse> {
  return tokenRequest(options, 'token refresh', {
    grant_type: 'refresh_token',
    client_id: LOGIN_CLIENT_ID,
    refresh_token: options.refreshToken,
  });
}

async function tokenRequest(
  options: TokenRequestOptions,
  action: string,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await request(options.url ?? LOGIN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: 'https://sso.motogp.com',
      referer: 'https://sso.motogp.com/',
      ...options.headers,
    },
    body: JSON.stringify(body),
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
  });
  if (response.statusCode !== 200) throw new LoginError(response.statusCode, await response.body.text(), action);
  return (await response.body.json()) as TokenResponse;
}

/** One licence held by an account, from {@link PERMISSIONS_URL}. */
export interface Permission {
  id: string;
  subscription: { id: string; origin: string };
  licence: {
    /** See {@link timingPassLicenceId}. */
    id: string;
    name: string;
    /** `subscription`, ... */
    type: string;
    legacy_id: string;
  };
  /** The account's id (the token's `sub`). */
  dorna_id: string;
  /** ISO times; `end` is `null` while the subscription runs. */
  date: { start: string; end: string | null };
  /** `ACTIVE`, ... */
  status: string;
}

export interface PermissionsOptions {
  /** Default {@link PERMISSIONS_URL}. */
  readonly url?: string;
  readonly dispatcher?: Dispatcher;
  /** Extra headers, such as a browser `user-agent`. */
  readonly headers?: Record<string, string>;
}

/** The permissions endpoint refused the request: 401 for a bad or expired token. */
export class PermissionsError extends Error {
  override readonly name = 'PermissionsError';
  constructor(readonly statusCode: number, readonly body: string) {
    super(`MotoGP permissions request failed (HTTP ${statusCode}).`);
  }
}

/** The account's active licences. Throws {@link PermissionsError} when the token is refused. */
export async function activePermissions(token: string, options: PermissionsOptions = {}): Promise<Permission[]> {
  const response = await request(options.url ?? PERMISSIONS_URL, {
    headers: { accept: 'application/json', ...options.headers, authorization: `Bearer ${token.replace(/^bearer /i, '')}` },
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
  });
  if (response.statusCode !== 200) throw new PermissionsError(response.statusCode, await response.body.text());
  const body: unknown = await response.body.json();
  return Array.isArray(body) ? (body as Permission[]) : [];
}

export interface LicenceIdOptions {
  /** The timingpass site. Default {@link TIMINGPASS_URL}. */
  readonly siteUrl?: string;
  readonly dispatcher?: Dispatcher;
  readonly headers?: Record<string, string>;
}

/** The site config sets the licence id as `timingpassLicenseId:"<uuid>"`. */
const LICENCE_ID_PATTERN = /timingpassLicenseId\s*:\s*["']([0-9a-f-]{36})["']/i;

/** Successful lookups, per dispatcher (the default one under `DEFAULT_DISPATCHER`) and site. */
const licenceIds = new WeakMap<object, Map<string, string>>();
const DEFAULT_DISPATCHER = {};

/**
 * The Timing Pass licence id, read from the timingpass site's runtime config
 * (`timingpassLicenseId` in its HTML), so a new id is picked up without a
 * release. Found ids are cached for the life of the process; failures are
 * not cached. Throws when the page cannot be read or no longer has the id.
 */
export async function timingPassLicenceId(options: LicenceIdOptions = {}): Promise<string> {
  const site = new URL('/en', options.siteUrl ?? TIMINGPASS_URL).toString();
  const key = options.dispatcher ?? DEFAULT_DISPATCHER;
  const cache = licenceIds.get(key) ?? new Map<string, string>();
  licenceIds.set(key, cache);
  const cached = cache.get(site);
  if (cached) return cached;
  const response = await request(site, {
    headers: { accept: 'text/html', ...options.headers },
    ...(options.dispatcher ? { dispatcher: options.dispatcher } : {}),
  });
  const html = await response.body.text();
  if (response.statusCode !== 200) throw new Error(`Timingpass site answered HTTP ${response.statusCode}: ${site}`);
  const id = LICENCE_ID_PATTERN.exec(html)?.[1];
  if (!id) throw new Error(`No timingpassLicenseId in the timingpass site config: ${site}`);
  cache.set(site, id);
  return id;
}

export interface TimingPassOptions extends PermissionsOptions, Pick<LicenceIdOptions, 'siteUrl'> {
  /** Use this licence id instead of reading it from the site. */
  readonly licenceId?: string;
  /** Instant to check subscription end dates against. Default `Date.now()`. */
  readonly now?: number;
}

/**
 * Whether the token's account has an active Timing Pass, the way the
 * timingpass site decides it: an `ACTIVE` licence with the Timing Pass
 * licence id ({@link timingPassLicenceId}) that has not ended. The access
 * token's own claims do not say. If the site config cannot be read, the last
 * known id ({@link TIMING_PASS_LICENCE_ID}) is used instead. Throws
 * {@link PermissionsError} when the token is refused.
 */
export async function hasTimingPass(token: string, options: TimingPassOptions = {}): Promise<boolean> {
  const now = options.now ?? Date.now();
  const [licenceId, permissions] = await Promise.all([
    options.licenceId ?? timingPassLicenceId(options).catch(() => TIMING_PASS_LICENCE_ID),
    activePermissions(token, options),
  ]);
  return permissions.some(
    (permission) =>
      permission.licence?.id === licenceId &&
      permission.status === 'ACTIVE' &&
      (!permission.date?.end || Date.parse(permission.date.end) > now),
  );
}

/** Expiry of a JWT access token as UTC epoch milliseconds, or `undefined` if it has none. */
export function tokenExpiry(token: string): number | undefined {
  const payload = token.replace(/^bearer /i, '').split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
