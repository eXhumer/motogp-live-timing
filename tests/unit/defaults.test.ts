import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activePermissions, hasTimingPass, login, TIMING_PASS_LICENCE_ID, timingPassLicenceId } from '../../src/auth.js';
import { LIVE_URL, LiveClient } from '../../src/live.js';
import { OnDemandClient } from '../../src/ondemand.js';
import { timelineFromLines } from '../../src/replay.js';
import { replayLines } from '../helpers/fixtures.js';

const io = vi.hoisted(() => vi.fn());
vi.mock('socket.io-client', () => ({ io }));

const original = getGlobalDispatcher();
afterEach(() => {
  setGlobalDispatcher(original);
});

describe('defaults', () => {
  it('connects with socket.io-client and no options', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      connected: false,
      active: true,
      io: { on: vi.fn() },
      onAny: vi.fn(),
      disconnect: vi.fn(),
      on: (event: string, listener: (...args: unknown[]) => void) => handlers.set(event, listener),
      emit: vi.fn(),
      // Like the real server: the snapshot comes unasked once connected.
      connect() {
        this.connected = true;
        handlers.get('connect')!();
        handlers.get('snapshot')!(replayLines()[0]!.data);
      },
    };
    io.mockReturnValue(socket);
    const client = await LiveClient.connect();
    expect(io).toHaveBeenCalledWith(LIVE_URL, expect.objectContaining({ autoConnect: false }));
    const off = client.subscribeStatus(() => undefined);
    off();
    await client.close();
  });

  it('uses the global undici dispatcher', async () => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.get('https://timingpass.motogp.com').intercept({ path: '/api/getIsLive' }).reply(200, '{"id":"e"}');
    agent.get('https://api.motogp.com').intercept({ path: '/login/token', method: 'POST' }).reply(200, '{"access_token":"a"}');
    setGlobalDispatcher(agent);
    expect(await new OnDemandClient().isLive()).toEqual({ id: 'e' });
    expect((await login({ username: 'u', password: 'p' })).access_token).toBe('a');
    const perms = JSON.stringify([{ licence: { id: TIMING_PASS_LICENCE_ID }, status: 'ACTIVE', date: { end: null } }]);
    agent.get('https://api.motogp.com').intercept({ path: '/perms/me?active=true' }).reply(200, perms).times(2);
    agent
      .get('https://timingpass.motogp.com')
      .intercept({ path: '/en' })
      .reply(200, `timingpassLicenseId:"${TIMING_PASS_LICENCE_ID}"`);
    expect(await activePermissions('t')).toHaveLength(1);
    expect(await hasTimingPass('t')).toBe(true);
    // Cached: the page was only served once.
    expect(await timingPassLicenceId()).toBe(TIMING_PASS_LICENCE_ID);
  });

  it('builds a timeline from lines without options', () => {
    expect(timelineFromLines(replayLines().slice(0, 3)).size).toBe(3);
  });
});
