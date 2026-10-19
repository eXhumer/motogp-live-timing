// Request /api/getRider for a few racers and save the raw responses, to
// document the endpoint. Not part of the package.
//
//   node scripts/probe-rider.mjs [--har <capture.har>] [--out <dir>] [rid[:season] ...]
//
// The token comes from MOTOGP_TOKEN, or from the DAT cookie of the first
// timingpass request in --har. It is sent the way the web app sends it (as the
// DAT cookie) and also as a bearer header; it is never printed.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { request } from 'undici';

const BASE = 'https://timingpass.motogp.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { har: { type: 'string' }, out: { type: 'string', default: 'probe-output' }, anonymous: { type: 'boolean' } },
});

async function tokenFromHar(path) {
  const har = JSON.parse(await readFile(path, 'utf8'));
  for (const entry of har.log.entries) {
    if (!entry.request.url.startsWith(BASE)) continue;
    const cookie = entry.request.headers.find((h) => h.name.toLowerCase() === 'cookie')?.value ?? '';
    const dat = cookie.split('; ').find((c) => c.startsWith('DAT='));
    if (dat) return dat.slice(4);
  }
  return undefined;
}

const token = values.anonymous ? undefined : (process.env.MOTOGP_TOKEN ?? (values.har ? await tokenFromHar(values.har) : undefined));
const targets = (positionals.length ? positionals : ['8269:2026']).map((arg) => {
  const [rid, season] = arg.split(':');
  return { rid, season };
});

await mkdir(values.out, { recursive: true });
console.log(`token: ${token ? 'yes' : 'no'}`);
for (const { rid, season } of targets) {
  const path = `/api/getRider/${rid}${season ? `?season=${season}` : ''}`;
  const response = await request(BASE + path, {
    headers: {
      accept: 'application/json',
      'user-agent': USER_AGENT,
      referer: `${BASE}/en`,
      ...(token ? { cookie: `DAT=${token}`, authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await response.body.text();
  const file = join(values.out, `rider-${rid}${season ? `-${season}` : ''}.json`);
  await writeFile(file, body);
  console.log(`${response.statusCode} ${path} ${response.headers['content-type'] ?? ''} ${body.length} bytes -> ${file}`);
}
