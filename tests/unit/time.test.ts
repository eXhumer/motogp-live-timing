import { describe, expect, it } from 'vitest';

import { formatGap, formatLapTime, toMilliseconds } from '../../src/time.js';

describe('time', () => {
  it('converts timing units to milliseconds', () => {
    expect(toMilliseconds(888_520)).toBe(88_852);
  });

  it('formats lap times', () => {
    expect(formatLapTime(888_520)).toBe('1:28.852');
    expect(formatLapTime(25_230)).toBe('0:02.523');
    expect(formatLapTime(0)).toBe('');
    expect(formatLapTime(Number.NaN)).toBe('');
  });

  it('formats gaps', () => {
    expect(formatGap(3_420)).toBe('0.342');
    expect(formatGap(1_090)).toBe('0.109');
    expect(formatGap(612_340)).toBe('1.01.234');
    expect(formatGap(-5)).toBe('');
  });
});
