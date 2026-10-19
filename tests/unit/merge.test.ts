import { describe, expect, it } from 'vitest';

import { applyRows, rowKey } from '../../src/merge.js';

describe('applyRows', () => {
  it('replaces single-value topics, last row wins', () => {
    expect(applyRows('weather', { airTemp: 1 }, { airTemp: 2 })).toEqual({ airTemp: 2 });
    expect(applyRows('session', undefined, [{ n: 'a' }, { n: 'b' }])).toEqual({ n: 'b' });
    expect(applyRows('weather', { airTemp: 1 }, [])).toEqual({ airTemp: 1 });
  });

  it('skips rows that are not objects', () => {
    expect(applyRows('racer', undefined, [null, 3, 'x'])).toBeUndefined();
  });

  it('upserts list rows by racer, id or record type', () => {
    const state = applyRows('topSpeed', undefined, [
      { rid: 1, topSpeed: 300 },
      { rid: 2, topSpeed: 301 },
    ]);
    const next = applyRows('topSpeed', state, { rid: 1, topSpeed: 310 });
    expect(next).toEqual([
      { rid: 1, topSpeed: 310 },
      { rid: 2, topSpeed: 301 },
    ]);
    expect(state).toEqual([
      { rid: 1, topSpeed: 300 },
      { rid: 2, topSpeed: 301 },
    ]);
    expect(applyRows('team', [{ id: 1, n: 'a' }], [{ id: 1, n: 'b' }, { id: 2, n: 'c' }])).toEqual([
      { id: 1, n: 'b' },
      { id: 2, n: 'c' },
    ]);
    expect(applyRows('record', [{ tp: 'P', v: 1 }], { tp: 'P', v: 2 })).toEqual([{ tp: 'P', v: 2 }]);
    expect(applyRows('boxInfo', { not: 'a list' }, { rid: 1 })).toEqual([{ rid: 1 }]);
  });

  it('picks the row key per topic', () => {
    expect(rowKey('record')).toBe('tp');
    expect(rowKey('officialMessage')).toBe('id');
    expect(rowKey('standingCurrentPosition')).toBe('rid');
  });

  it('keeps laps per racer, matched by lap number', () => {
    let state = applyRows('lap', undefined, [
      { rid: 1, nl: 1, lt: 100 },
      { rid: 1, nl: 2, lt: 99 },
      { rid: 2, nl: 1, lt: 101 },
    ]);
    state = applyRows('lap', state, { rid: 1, nl: 2, lt: 98 });
    expect(state).toEqual({
      '1': [
        { rid: 1, nl: 1, lt: 100 },
        { rid: 1, nl: 2, lt: 98 },
      ],
      '2': [{ rid: 2, nl: 1, lt: 101 }],
    });
    expect(applyRows('penalty', undefined, { a: { rid: 3, nl: 1 }, b: 'ignored' })).toEqual({ '3': [{ rid: 3, nl: 1 }] });
  });

  it('places sectors by racer, lap and sector number', () => {
    let state = applyRows('sector', undefined, [
      { rid: 1, ln: 1, sn: 2, t: 20 },
      { rid: 1, ln: 1, sn: 1, t: 10 },
    ]);
    state = applyRows('sector', state, { rid: 1, ln: 1, sn: 1, t: 11 });
    expect(state).toEqual({
      '1': {
        '1': [
          { rid: 1, ln: 1, sn: 1, t: 11 },
          { rid: 1, ln: 1, sn: 2, t: 20 },
        ],
      },
    });
    expect(applyRows('sector', state, { rid: 1, ln: 1, sn: 0 })).toBe(state);
    expect(applyRows('sector', state, { '2': { '1': [] } })).toEqual({ ...(state as object), '2': { '1': [] } });
  });

  it('nests run laps and run summaries', () => {
    const lap = { rid: 1, rn: 2, nl: 3 };
    expect(applyRows('runLap', undefined, lap)).toEqual({ '1': { '2': { '3': lap } } });
    expect(applyRows('runLap', undefined, { x: { y: [lap, 'skip'], z: 'skip' } })).toEqual({ '1': { '2': { '3': lap } } });
    const summary = { rid: 1, rn: 2, laps: 5 };
    expect(applyRows('runSummary', undefined, summary)).toEqual({ '1': { '2': summary } });
    expect(applyRows('runSummary', undefined, { x: { '2': summary, '3': 'skip' } })).toEqual({ '1': { '2': summary } });
  });

  it('keeps the newest marshal post state per track sector', () => {
    const green = { num: 4, atns: [1, 2], stt: 'green', sca: '2026-10-11T06:35:39.000Z' };
    const yellow = { num: 4, atns: [1], stt: 'yellow', sca: '2026-10-11T06:36:00.000Z' };
    const stale = { num: 4, atns: [1], stt: 'none', sca: '2026-10-11T06:00:00.000Z' };
    let state = applyRows('marshallingSectorState', [], green);
    state = applyRows('marshallingSectorState', state, [yellow, stale]);
    expect(state).toEqual({ '1': { '4': yellow }, '2': { '4': green } });
    expect(applyRows('marshallingSectorState', state, { num: 5 })).toBe(state);
  });
});
