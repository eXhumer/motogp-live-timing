import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { MockAgent } from 'undici';

import { type OnDemandLine, parseNdjson } from '../../src/decode.js';

export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** The 2026 Indonesian Grand Prix MotoGP race, as downloaded from `/api/ondemand/{fileId}`. */
export const REPLAY_FILE = join(FIXTURES, 'indonesia-2026-motogp-race.ndjson.gz');
/** The replay's file id on timingpass. */
export const REPLAY_FILE_ID = 'ca328bcf-4f49-46f4-ae56-6205d3e606fe';
/** Index of the second full snapshot in the replay (the session going green). */
export const MID_SNAPSHOT_INDEX = 3647;

let text: string | undefined;
let lines: OnDemandLine[] | undefined;

/** The replay file's text, exactly as served (it ends with an `owner` line). */
export function replayText(): string {
  return (text ??= gunzipSync(readFileSync(REPLAY_FILE)).toString('utf8'));
}

/** The replay's parsed lines (cached; do not mutate). */
export function replayLines(): OnDemandLine[] {
  return (lines ??= parseNdjson(replayText()));
}

/** `/api/ondemand/calendar`, trimmed to the season's first and last events. */
export function calendarJson(): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, 'ondemand-calendar.json'), 'utf8'));
}

/** Real `/api/getRider` responses, keyed by request path. */
export function riderResponses(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, 'riders.json'), 'utf8')) as Record<string, unknown>;
}

/** A MockAgent serving the timingpass API with the fixture replay. */
export function timingpassAgent(routes: Record<string, unknown> = {}): MockAgent {
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get('https://timingpass.motogp.com');
  pool
    .intercept({ path: () => true, method: 'GET' })
    .reply((options) => {
      if (options.path === `/api/ondemand/${REPLAY_FILE_ID}`) return { statusCode: 200, data: replayText() };
      const body = routes[options.path];
      return body === undefined ? { statusCode: 404, data: 'Not Found' } : { statusCode: 200, data: JSON.stringify(body) };
    })
    .persist();
  return agent;
}
