// Type-checks the built package through its public exports (run after `npm run build`).
import {
  type Cursor,
  formatLapTime,
  LiveClient,
  loadOnDemand,
  loadRecording,
  login,
  OnDemandClient,
  Recorder,
  type SessionState,
  type StandingRow,
  Timeline,
  type TimingMessage,
  type TopicState,
} from '@exhumer/motogp-live-timing';

export async function usage(): Promise<void> {
  const { access_token: token } = await login({ username: 'user', password: 'pass' });
  const client = new OnDemandClient({ token });
  const last = await client.lastOnDemand();
  const fileId = last.broadcasts?.find((b) => b.category === 'MotoGP')?.file_id ?? '';
  const timeline = await loadOnDemand(client, fileId);
  const cursor: Cursor = timeline.cursor();
  cursor.subscribe('standingCurrentPosition', (rows: TopicState<'standingCurrentPosition'> | undefined, { updates, reset }) => {
    const leader: StandingRow | undefined = rows?.find((row) => row.p === 1);
    const messages: readonly TimingMessage[] = updates;
    void [leader && formatLapTime(leader.t), messages, reset];
  });
  cursor.subscribe(['sessionStatus', 'weather'], (changed, reset) => void [changed, reset]);
  const state: SessionState = cursor.state;

  const live = await LiveClient.connect({ token: () => token });
  using liveTimeline = Timeline.fromLive(live);
  await using recorder = await Recorder.create('rec/race.ndjson');
  for await (const message of live.messages()) recorder.write(message);
  const replayed: Timeline = await loadRecording('rec/race.ndjson');
  void [state, liveTimeline, replayed];
}
