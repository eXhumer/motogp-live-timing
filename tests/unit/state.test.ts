import { describe, expect, it, vi } from 'vitest';

import { isFullSnapshot, isRefresh, lineToMessage, type TimingMessage } from '../../src/decode.js';
import { applyMessage, EMPTY_STATE, getTopic, isAwaitingSnapshot, type SessionState } from '../../src/state.js';
import { Timeline } from '../../src/timeline.js';
import { MID_SNAPSHOT_INDEX, replayLines } from '../helpers/fixtures.js';

const at = (utc: number, data: Record<string, unknown>): TimingMessage => ({ utc, data });
/** A full snapshot: more than five topics including `session`. */
const full = (extra: Record<string, unknown> = {}) =>
  ({ session: { n: 'RAC' }, clock: { ltm: 1 }, weather: {}, track: {}, event: {}, season: {}, ...extra }) as const;

function replay(messages: readonly TimingMessage[], from: SessionState = EMPTY_STATE): SessionState {
  return messages.reduce(applyMessage, from);
}

describe('applyMessage', () => {
  it('merges deltas topic by topic and leaves other topics untouched', () => {
    const weather = { airTemp: 20 };
    const state = replay([at(1, { weather }), at(2, { topSpeed: [{ rid: 1, topSpeed: 300 }] })]);
    expect(state['weather']).toBe(weather);
    expect(getTopic(state, 'topSpeed')).toEqual([{ rid: 1, topSpeed: 300 }]);
  });

  it('replaces the state on a full snapshot and drops the flash message', () => {
    const before = replay([at(1, { racer: [{ rid: 1 }], flashMessage: { txt: 'crash' } })]);
    const after = applyMessage(before, at(2, full({ flashMessage: { txt: 'new' } })));
    expect(after['racer']).toBeUndefined();
    expect(after['flashMessage']).toBeUndefined();
    expect(after['session']).toEqual({ n: 'RAC' });
  });

  it('ignores deltas between a refresh and the next snapshot-sized message', () => {
    const before = replay([at(1, { weather: { airTemp: 20 } })]);
    const waiting = applyMessage(before, at(2, { refresh: true }));
    expect(isAwaitingSnapshot(waiting)).toBe(true);
    expect(Object.keys(waiting)).toEqual(['weather']);
    expect(applyMessage(waiting, at(3, { weather: { airTemp: 30 } }))).toBe(waiting);
    // While waiting, six topics are enough even without `session` or `event`.
    const sized = { a: [], b: [], c: [], d: [], e: [], weather: { airTemp: 25 } };
    const after = applyMessage(waiting, at(4, sized));
    expect(isAwaitingSnapshot(after)).toBe(false);
    expect(after['weather']).toEqual({ airTemp: 25 });
    expect(isAwaitingSnapshot(applyMessage(EMPTY_STATE, at(5, { refresh: true, ...full() })))).toBe(false);
  });

  it('rebuilds every static topic of the mid-race snapshot from deltas', () => {
    const lines = replayLines();
    const built = replay(lines.slice(0, MID_SNAPSHOT_INDEX).map(lineToMessage));
    const snapshot = applyMessage(built, lineToMessage(lines[MID_SNAPSHOT_INDEX]!));
    expect(isFullSnapshot(lines[MID_SNAPSHOT_INDEX]!.data)).toBe(true);
    // These change at the green light, so the snapshot legitimately differs.
    const changing = new Set([
      'sessionTime',
      'sessionStatus',
      'standingCurrentPosition',
      'standingConsolidatedPosition',
      'standingAtTrackPosPosition',
      'standingChampionshipRacerAtTrackPosPosition',
      'boxInfo',
      'trackProgress',
      'racerTyres',
    ]);
    const sorted = (value: unknown) =>
      Array.isArray(value) ? value.map((row) => JSON.stringify(row)).sort() : JSON.stringify(value);
    const compared = Object.keys(snapshot).filter((topic) => !changing.has(topic));
    expect(compared.length).toBeGreaterThan(20);
    for (const topic of compared) expect([topic, sorted(built[topic])]).toEqual([topic, sorted(snapshot[topic])]);
  });

  it('plays the whole fixture race to the finish', () => {
    const lines = replayLines();
    expect(lines.some((line) => isRefresh(line.data))).toBe(false);
    const end = replay(lines.map(lineToMessage));
    expect(getTopic(end, 'sessionStatus')?.s).toBe('F');
    expect(getTopic(end, 'championship')?.shn).toBe('MotoGP');
    expect(getTopic(end, 'lap')?.['8269']?.length).toBeGreaterThan(20);
  });
});

describe('Cursor with snapshots', () => {
  it('notifies topics a full snapshot removes', () => {
    const timeline = new Timeline();
    timeline.insert([at(1, { racer: [{ rid: 1 }] }), at(2, full())]);
    const cursor = timeline.cursor();
    const changed = vi.fn();
    cursor.subscribe(['racer', 'session'], changed);
    cursor.advanceTo(1);
    expect(changed).toHaveBeenLastCalledWith(['racer'], false);
    cursor.advanceTo(2);
    expect(changed).toHaveBeenLastCalledWith(['racer', 'session'], false);
    cursor.advanceTo(3);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(timeline.topics()).not.toContain('racer');
  });

  it('does not notify ignored deltas while a snapshot is awaited', () => {
    const timeline = new Timeline();
    timeline.insert([at(1, { refresh: true }), at(2, { weather: { airTemp: 1 } })]);
    const cursor = timeline.cursor();
    const weather = vi.fn();
    cursor.subscribe('weather', weather);
    cursor.advanceTo(2);
    expect(weather).not.toHaveBeenCalled();
  });
});
