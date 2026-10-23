# @exhumer/motogp-live-timing

[![CI](https://github.com/eXhumer/motogp-live-timing/actions/workflows/ci.yml/badge.svg)](https://github.com/eXhumer/motogp-live-timing/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/eXhumer/motogp-live-timing/branch/main/graph/badge.svg)](https://codecov.io/gh/eXhumer/motogp-live-timing)

MotoGP, Moto2 and Moto3 live timing for Node.js: the live Socket.IO feed,
on-demand replays and local recordings, all as one timeline you can scrub in
step with a video. Modelled on
[`@exhumer/f1-live-timing`](https://github.com/eXhumer/f1-live-timing).

- Live data comes from `lts.motogp.com/livetiming24-server` through
  [socket.io-client](https://github.com/socketio/socket.io-client).
- Replays and the schedule come from `timingpass.motogp.com/api` through
  [undici](https://github.com/nodejs/undici).

> **Status: early.** Replays and the merge rules are tested against a full
> 2026 Indonesian GP race. The live client has been checked against a live
> session (Moto3 practice at the 2026 Australian GP), but only for minutes.

**This package is unofficial and is not associated in any way with MotoGP Sports Entertainment Group (formerly Dorna Sports) or the FIM. MotoGP, Moto2, Moto3 and related marks are trade marks of their owners.**

## Requirements

- Node.js ≥ 22.19.0
- A MotoGP account with a Timing Pass. Replays return HTTP 401 without a token.

The pass is not in the access token's claims (they only say `Registered`). It
is an active licence on the account, listed by
`GET https://api.motogp.com/perms/me?active=true`. The Timing Pass licence id is
the `timingpassLicenseId` in the timingpass site's runtime config (currently
`65028c47-0994-432b-a300-ffdcc97447c1`). The site uses it to unlock pages, and
the API presumably checks it server side. `hasTimingPass(token)` checks it the
same way. It reads the current id from the site (`timingPassLicenceId()`,
cached per process) and falls back to the last known id only if the page can't
be read:

```ts
import { hasTimingPass } from '@exhumer/motogp-live-timing';

if (!(await hasTimingPass(token))) throw new Error('This account has no Timing Pass.');
```

## Quick start

### Sign in

```ts
import { login, tokenExpiry } from '@exhumer/motogp-live-timing';

const { access_token: token } = await login({ username, password });
console.log(new Date(tokenExpiry(token)!)); // about 31 days
```

`token` is the same value as the `DAT` cookie on motogp.com. The response also
has a `refresh_token` (the `DRT` cookie, valid for about 4 months), which can be
exchanged for a new access token:

```ts
import { refreshToken } from '@exhumer/motogp-live-timing';

const next = await refreshToken({ refreshToken: drt });
// next.access_token: a new 31-day DAT.
// next.refresh_token: a new DRT. Refresh tokens rotate, so store it.
```

The login endpoint sits behind Imperva, which may challenge requests that don't
look like a browser. If that happens, copy the `DAT` and `DRT` cookies from a
signed-in browser instead.

### Replay a session

```ts
import { loadOnDemand, OnDemandClient, formatLapTime } from '@exhumer/motogp-live-timing';

const client = new OnDemandClient({ token });
const calendar = await client.calendar(); // every event of the season, oldest first
const indonesia = calendar.find((event) => event.shortname === 'INA')!;
const race = indonesia.broadcasts.find((b) => b.category === 'MotoGP' && b.shortname === 'RAC')!;

const timeline = await loadOnDemand(client, race.file_id);
const cursor = timeline.cursor();
cursor.subscribe('standingCurrentPosition', (rows) => {
  const leader = rows?.find((row) => row.p === 1);
  if (leader) console.log('Leader', leader.rid, formatLapTime(leader.t));
});

// Call on every video frame or timeupdate with the video's UTC time.
cursor.advanceTo(Date.parse('2026-10-11T07:10:00Z'));
```

### Follow a live session

```ts
import { LiveClient, Timeline } from '@exhumer/motogp-live-timing';

const live = await LiveClient.connect({ token: () => token });
const timeline = Timeline.fromLive(live); // starts from live.snapshot

const cursor = timeline.cursor();
cursor.follow();
cursor.subscribe(['sessionStatus', 'flashMessage'], (changed) => {
  for (const topic of changed) console.log(topic, cursor.get(topic));
});
```

The live server streams whichever session is on track. Read `championship.shn`
(`MotoGP`, `Moto2`, `Moto3`) and `session.shn` to see which one it is.

Live timing needs a token, like replays. Without one, or with an expired one,
the server answers `NOT_AUTHORISED` and `connect` rejects with a
`LiveAuthError` (`hadToken` says which).

`connect` resolves with the first full snapshot, which reaches listeners before
you can subscribe: read it from `live.snapshot`. `Timeline.fromLive` starts
from it; a recording should write it first.

### Record and play back

```ts
import { LiveClient, loadRecording, Recorder } from '@exhumer/motogp-live-timing';

const recorder = await Recorder.create('./recordings/australia-race.ndjson');
recorder.write(live.snapshot);
live.subscribeMessages((message) => recorder.write(message));
// ...
await recorder.close();

const timeline = await loadRecording('./recordings/australia-race.ndjson');
```

Recordings use the on-demand replay format (one
`{"timestamp","relativeTime","data"}` line per update), so `loadRecording` also
reads a saved replay download, gzipped or not.

### Rider profiles

The timing feed identifies riders by `rid`, which is the profile's `legacy_id`:

```ts
const profile = await new OnDemandClient().rider(8269, 2026);
// { legacy_id: 8269, name: 'Raul', surname: 'Fernandez', country: { iso: 'ES', ... },
//   career: { number: 25, team: { name, color, constructor: { legacy_id: 7 }, category }, pictures } }
```

`career.team.constructor.legacy_id` is the feed's `bid`, and
`career.team.category.legacy_id` is its `championship.chid`. The team's
`legacy_id` usually equals the feed's `tid`, but not always. Older seasons can
have `category: null`, and a season before the rider's career returns the
current one.

`scripts/probe-rider.mjs` saves raw responses for any `rid[:season]`, for
checking this against new data.

## Concepts

### Messages

```ts
interface TimingMessage {
  utc: number; // epoch milliseconds
  data: Record<string, unknown>; // topic → row or rows, as Dorna sends them
}
```

Replay lines carry their own timestamps. Live `snapshot` events carry none, so
they are stamped on arrival.

The live server sends nothing but `snapshot` events. On connect it sends
`{ refresh: 1 }`, then a full snapshot (about 150 KB), then only the topics that
change, several times a second (`clock`, `sessionTime`, `trackProgress`,
`lap`, `sector`, `weather` and so on). The client never asks for snapshots:
the server answers each request with another `refresh` and full snapshot.

At the chequered flag `sessionStatus.s` goes from `S` to `C`, then to `F` once
the results are final, a few minutes later. The connection stays open between
sessions: when the next one is set up, the server sends `refresh` and a full
snapshot of it (status `N`), which replaces the state. Race control notices
(crashes, cancelled lap times) arrive in `flashMessage`.

A red flag arrives as deltas, without a snapshot. `marshallingTrackState` turns
`red`, then `sessionStatus.s` turns `I` about 300 ms later, and `sessionTime`
stops. Lap times set while the flag is out are cancelled in `flashMessage`. At
the restart the track state goes back to `none` and the status goes to `R`, not
`S`. `R` lasts until the chequered flag, so a red-flagged session ends
`R → C → F` (about five minutes from `C` to `F`).

The server streams to one connection per token. A second connection with the
same token gets its first snapshot and then nothing more until the first one
disconnects. It then gets a `refresh` and a new full snapshot.

### Merging

Each topic update is a row or an array of rows, merged with the rules of the
timingpass web app:

| Topics | State |
| --- | --- |
| `clock`, `session`, `sessionStatus`, `sessionTime`, `track`, `weather`, `event`, `settings`, `season`, `championship`, `flashMessage` | The latest row |
| `lap`, `penalty` | `{ [rid]: Row[] }`, matched by lap `nl` |
| `sector` | `{ [rid]: { [ln]: Row[] } }`, sector `sn` at index `sn - 1` |
| `runLap` / `runSummary` | `{ [rid]: { [rn]: { [nl]: Row } } }` / `{ [rid]: { [rn]: Row } }` |
| `marshallingSectorState` | `{ [sector]: { [post]: Row } }`, newest `sca` wins |
| `record` | `Row[]` matched by `tp` |
| `bike`, `team`, `entryTeam`, `officialMessage`, `standingChampionship*` | `Row[]` matched by `id` |
| every other topic | `Row[]` matched by `rid` |

A message with more than five topics including `session` or `event` is a full
snapshot and replaces the state. A `refresh` message makes the state ignore
deltas until the next snapshot. `applyMessage` and `applyRows` are exported.

### Units

Times and gaps are in 1/10 000 s: `toMilliseconds`, `formatLapTime` and
`formatGap` convert them. `clock.ltm` is the local time of day at the track in
the same unit. Speed records (`record.tp` `S` and `D`) are km/h × 100.

### Timeline and cursors

These work exactly as in f1-live-timing: `advanceTo(utc)`, `seek(utc)`,
`follow()`, `state`, `get(topic)` and `subscribe(...)`, with checkpoints every
30 s.

## API

| Export | Purpose |
| --- | --- |
| `OnDemandClient` | `isLive()`, `schedule()`, `lastOnDemand()`, `calendar()`, `rider(rid)`, `lines(fileId)`, `messages(fileId)` |
| `rider(rid, season?)` | `RiderProfile`: name, country, and that season's number, team, constructor and pictures. No token needed. `undefined` for an unknown id |
| `OnDemandEvent`, `OnDemandBroadcast` | Calendar entries: an event's sessions for all three classes, each with a `file_id` |
| `loadOnDemand(client, fileId)` | Stream a replay into a `Timeline` |
| `LiveClient.connect(options)` | Live feed; `token`, `url`, `path`, `headers`, `reconnectionAttempts`, `snapshotTimeout`, `refreshTimeout`, `socketFactory`. `live.snapshot` is the state it connected with |
| `LiveAuthError` | The live server refused the token (`NOT_AUTHORISED`); `hadToken` tells a rejected token from a missing one |
| `Recorder`, `loadRecording` | Write and read NDJSON recordings |
| `login`, `refreshToken`, `tokenExpiry` | Account sign-in, token refresh and token expiry |
| `hasTimingPass`, `activePermissions`, `timingPassLicenceId` | Whether the account has an active Timing Pass, its licences, and the pass's current licence id |
| `Timeline`, `Cursor` | Scrubbable session state |

## Not yet known

- How the live feed behaves across a server-side reconnect.
- Whether `R` also appears without a red flag, and which `marshallingTrackState`
  values exist besides `none` and `red`.
- Whether a refresh token stays valid after it has been used once.

## License

MIT
