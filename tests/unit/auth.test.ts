import { MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import {
  activePermissions,
  hasTimingPass,
  login,
  LOGIN_CLIENT_ID,
  LoginError,
  ORIGIN_CLIENT_ID,
  type Permission,
  PermissionsError,
  refreshToken,
  TIMING_PASS_LICENCE_ID,
  timingPassLicenceId,
  tokenExpiry,
} from '../../src/auth.js';

const jwt = (claims: unknown) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

/** The endpoint's real answer to a made-up refresh token. */
const INVALID_GRANT = '{"error":"invalid_grant","error_type":"invalid_grant","message":"The refresh token is invalid."}';

function loginAgent(
  statusCode: number,
  onBody: (body: unknown) => void = () => undefined,
  failure = 'denied',
): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent
    .get('https://api.motogp.com')
    .intercept({ path: '/login/token', method: 'POST' })
    .reply((options) => {
      onBody(JSON.parse(String(options.body)));
      return statusCode === 200
        ? {
            statusCode,
            // The shape of a real login and refresh answer.
            data: { token_type: 'Bearer', expires_in: 2_678_400, access_token: 'a', refresh_token: 'r', issued_token_type: null },
          }
        : { statusCode, data: failure };
    });
  return agent;
}

describe('login', () => {
  it('uses the password grant of the motogp.com login page', async () => {
    let body: unknown;
    const tokens = await login({
      username: 'rider@example.com',
      password: 'secret',
      dispatcher: loginAgent(200, (b) => (body = b)),
      headers: { 'user-agent': 'test' },
    });
    expect(body).toEqual({
      grant_type: 'password',
      client_id: LOGIN_CLIENT_ID,
      username: 'rider@example.com',
      password: 'secret',
      origin_client_id: ORIGIN_CLIENT_ID,
    });
    expect(tokens.access_token).toBe('a');
  });

  it('throws on failure', async () => {
    const error = await login({ username: 'u', password: 'p', dispatcher: loginAgent(401) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoginError);
    expect(error).toMatchObject({ statusCode: 401, body: 'denied' });
  });
});

describe('refreshToken', () => {
  it('uses the refresh_token grant', async () => {
    let body: unknown;
    const tokens = await refreshToken({ refreshToken: 'drt', dispatcher: loginAgent(200, (b) => (body = b)) });
    expect(body).toEqual({ grant_type: 'refresh_token', client_id: LOGIN_CLIENT_ID, refresh_token: 'drt' });
    expect(tokens).toEqual({
      token_type: 'Bearer',
      expires_in: 2_678_400,
      access_token: 'a',
      refresh_token: 'r',
      issued_token_type: null,
    });
  });

  it('throws invalid_grant as a LoginError', async () => {
    const error = await refreshToken({ refreshToken: 'dummy', dispatcher: loginAgent(400, undefined, INVALID_GRANT) }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(LoginError);
    expect(error).toMatchObject({ statusCode: 400, message: 'MotoGP token refresh failed (HTTP 400).' });
    expect(JSON.parse((error as LoginError).body)).toMatchObject({ error: 'invalid_grant' });
  });
});

/** A licence shaped like a real `/perms/me` row (ids and names are placeholders). */
const permission = (licenceId: string, overrides: Partial<Permission> = {}): Permission => ({
  id: 'p1',
  subscription: { id: 'sub', origin: 'store' },
  licence: { id: licenceId, name: 'Licence', type: 'subscription', legacy_id: '47' },
  dorna_id: 'account',
  date: { start: '2026-08-28T10:11:28+00:00', end: null },
  status: 'ACTIVE',
  ...overrides,
});

/** The timingpass page's runtime config, as served (trimmed). */
const sitePage = (licenceId: string) =>
  `<script>window.__NUXT__.config={public:{socketPath:"/livetiming24-server",timingpassLicenseId:"${licenceId}",apiPermsUrl:"http://perms"}}</script>`;

/** Serves `/perms/me` and, unless `site` is `null`, the timingpass page with that licence id. */
function permsAgent(
  statusCode: number,
  data: unknown,
  seen: (string | undefined)[] = [],
  site: { status?: number; body?: string; requests?: string[] } | null = {},
): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  if (site) {
    agent
      .get('https://timingpass.motogp.com')
      .intercept({ path: '/en', method: 'GET' })
      .reply((options) => {
        site.requests?.push(options.path);
        return { statusCode: site.status ?? 200, data: site.body ?? sitePage(TIMING_PASS_LICENCE_ID) };
      })
      .persist();
  }
  agent
    .get('https://api.motogp.com')
    .intercept({ path: '/perms/me?active=true', method: 'GET' })
    .reply((options) => {
      seen.push((options.headers as Record<string, string>)['authorization']);
      return { statusCode, data: typeof data === 'string' ? data : JSON.stringify(data) };
    })
    .persist();
  return agent;
}

describe('permissions', () => {
  it('lists active licences with the token as a bearer', async () => {
    const seen: (string | undefined)[] = [];
    const rows = [permission('other'), permission(TIMING_PASS_LICENCE_ID)];
    const dispatcher = permsAgent(200, rows, seen);
    expect(await activePermissions('Bearer tok', { dispatcher, headers: { authorization: 'ignored' } })).toEqual(rows);
    expect(seen).toEqual(['Bearer tok']);
    expect(await activePermissions('tok', { dispatcher: permsAgent(200, { not: 'a list' }) })).toEqual([]);
  });

  it('detects the Timing Pass', async () => {
    const check = (rows: unknown[]) => hasTimingPass('tok', { dispatcher: permsAgent(200, rows), now: Date.parse('2026-10-19') });
    expect(await check([permission('other'), permission(TIMING_PASS_LICENCE_ID)])).toBe(true);
    expect(await check([permission('other')])).toBe(false);
    expect(await check([])).toBe(false);
    expect(await check([permission(TIMING_PASS_LICENCE_ID, { status: 'CANCELLED' })])).toBe(false);
    const ended = { start: '2026-01-01T00:00:00+00:00', end: '2026-09-01T00:00:00+00:00' };
    expect(await check([permission(TIMING_PASS_LICENCE_ID, { date: ended })])).toBe(false);
    const ending = { start: '2026-01-01T00:00:00+00:00', end: '2026-12-01T00:00:00+00:00' };
    expect(await check([permission(TIMING_PASS_LICENCE_ID, { date: ending })])).toBe(true);
    expect(await check([{ status: 'ACTIVE' }, { licence: { id: TIMING_PASS_LICENCE_ID }, status: 'ACTIVE' }])).toBe(true);
  });

  it('reads the licence id from the timingpass site and caches it', async () => {
    const requests: string[] = [];
    const dispatcher = permsAgent(200, [], [], { body: sitePage('11111111-2222-3333-4444-555555555555'), requests });
    expect(await timingPassLicenceId({ dispatcher })).toBe('11111111-2222-3333-4444-555555555555');
    expect(await timingPassLicenceId({ dispatcher, siteUrl: 'https://timingpass.motogp.com' })).toBe(
      '11111111-2222-3333-4444-555555555555',
    );
    expect(requests).toEqual(['/en']);
  });

  it('follows a changed licence id', async () => {
    const changed = '11111111-2222-3333-4444-555555555555';
    const site = { body: sitePage(changed) };
    const check = (rows: unknown[]) => hasTimingPass('tok', { dispatcher: permsAgent(200, rows, [], site) });
    expect(await check([permission(changed)])).toBe(true);
    expect(await check([permission(TIMING_PASS_LICENCE_ID)])).toBe(false);
    const override = { dispatcher: permsAgent(200, [permission('mine')], [], null), licenceId: 'mine' };
    expect(await hasTimingPass('tok', override)).toBe(true);
  });

  it('falls back to the last known id when the site config is unreadable', async () => {
    for (const site of [{ status: 503, body: 'down' }, { body: '<html>no config</html>' }]) {
      const dispatcher = permsAgent(200, [permission(TIMING_PASS_LICENCE_ID)], [], site);
      await expect(timingPassLicenceId({ dispatcher })).rejects.toThrow(/HTTP 503|No timingpassLicenseId/);
      expect(await hasTimingPass('tok', { dispatcher })).toBe(true);
    }
  });

  it('throws when the token is refused', async () => {
    const body = '{"error_type":"authentication","message":"Authentication Required"}';
    const error = await hasTimingPass('expired', { dispatcher: permsAgent(401, body) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermissionsError);
    expect(error).toMatchObject({ statusCode: 401, body, message: 'MotoGP permissions request failed (HTTP 401).' });
  });
});

describe('tokenExpiry', () => {
  it('reads the exp claim', () => {
    expect(tokenExpiry(jwt({ exp: 1_795_071_699 }))).toBe(1_795_071_699_000);
    expect(tokenExpiry(`Bearer ${jwt({ exp: 1 })}`)).toBe(1000);
    expect(tokenExpiry(jwt({}))).toBeUndefined();
    expect(tokenExpiry('opaque')).toBeUndefined();
    expect(tokenExpiry('a.!!!.c')).toBeUndefined();
  });
});
