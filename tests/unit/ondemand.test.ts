import { MockAgent } from 'undici';
import { describe, expect, it } from 'vitest';

import { OnDemandClient, OnDemandHttpError } from '../../src/ondemand.js';
import { loadOnDemand } from '../../src/replay.js';
import { calendarJson, REPLAY_FILE_ID, riderResponses, timingpassAgent } from '../helpers/fixtures.js';

const event = { id: 'e1', name: 'GP', broadcasts: [{ id: 'b1', category: 'MotoGP', file_id: REPLAY_FILE_ID }] };
const routes = {
  '/api/getIsLive': event,
  '/api/getSchedule/': { event, sessions: [] },
  '/api/ondemand/last': event,
  '/api/ondemand/calendar': calendarJson(),
  ...riderResponses(),
  '/api/getRider/8269': [],
};

describe('OnDemandClient', () => {
  it('reads the schedule endpoints', async () => {
    const client = new OnDemandClient({ dispatcher: timingpassAgent(routes) });
    expect(await client.isLive()).toEqual(event);
    expect((await client.schedule()).event).toEqual(event);
    expect((await client.lastOnDemand()).broadcasts?.[0]?.file_id).toBe(REPLAY_FILE_ID);
    const calendar = await client.calendar();
    expect(calendar.map((e) => e.shortname)).toEqual(['THA', 'INA']);
    expect(calendar.every((e) => e.broadcasts.length === 20 && e.broadcasts.every((b) => b.file_id))).toBe(true);
    const race = calendar
      .flatMap((e) => e.broadcasts)
      .find((b) => b.category === 'MotoGP' && b.shortname === 'RAC' && b.date_start.startsWith('2026-10-11'));
    expect(race?.file_id).toBe(REPLAY_FILE_ID);
    expect(client.url('/api/x')).toBe('https://timingpass.motogp.com/api/x');
  });

  it('reads rider profiles', async () => {
    const client = new OnDemandClient({ dispatcher: timingpassAgent(routes) });
    const raul = await client.rider(8269, 2026);
    expect(raul).toMatchObject({ legacy_id: 8269, surname: 'Fernandez', career: { number: 25 } });
    expect(raul?.career.team?.constructor.legacy_id).toBe(7);
    expect(raul?.career.team?.category?.name).toBe('MotoGP');
    const rookie = await client.rider(8269, 2019);
    expect(rookie?.career.team?.category).toBeNull();
    expect(rookie?.career.team?.constructor.name).toBe('Speed Up');
    expect((await client.rider(1, 2026))?.career.team).toBeNull();
    expect(await client.rider(99999999)).toBeUndefined();
    expect(await client.rider(8269)).toBeUndefined();
  });

  it('streams a replay into a timeline', async () => {
    const client = new OnDemandClient({ dispatcher: timingpassAgent() });
    const progress: number[] = [];
    const timeline = await loadOnDemand(client, REPLAY_FILE_ID, {
      checkpointInterval: 60_000,
      onProgress: (lines) => progress.push(lines),
    });
    expect(timeline.size).toBe(19_685);
    expect(progress.at(-1)).toBe(19_685);
    expect(progress).toHaveLength(20);
    expect(timeline.latest()['sessionStatus']).toEqual({ id: 1, s: 'F' });
    const empty = await loadOnDemand(new OnDemandClient({ dispatcher: emptyReplayAgent() }), 'empty');
    expect(empty.size).toBe(0);
  });

  it('sends the token as a bearer header', async () => {
    const seen: (string | undefined)[] = [];
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent
      .get('https://timingpass.motogp.com')
      .intercept({ path: '/api/getIsLive', method: 'GET' })
      .reply((options) => {
        seen.push((options.headers as Record<string, string>)['authorization']);
        return { statusCode: 200, data: '{}' };
      })
      .persist();
    await new OnDemandClient({ dispatcher: agent, token: 'abc', headers: { 'user-agent': 'x' } }).isLive();
    await new OnDemandClient({ dispatcher: agent, token: () => Promise.resolve('Bearer def') }).isLive();
    await new OnDemandClient({ dispatcher: agent, token: () => undefined }).isLive();
    expect(seen).toEqual(['Bearer abc', 'Bearer def', undefined]);
  });

  it('throws on other statuses', async () => {
    const client = new OnDemandClient({ dispatcher: timingpassAgent(), baseUrl: 'https://timingpass.motogp.com' });
    const error = await client.isLive().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OnDemandHttpError);
    expect(error).toMatchObject({ statusCode: 404, url: 'https://timingpass.motogp.com/api/getIsLive' });
  });

  it('uses the global dispatcher by default', () => {
    expect(new OnDemandClient().url('/')).toBe('https://timingpass.motogp.com/');
  });
});

function emptyReplayAgent(): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent.get('https://timingpass.motogp.com').intercept({ path: '/api/ondemand/empty' }).reply(200, '{"owner":"x"}\n');
  return agent;
}
