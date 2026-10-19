import { describe, expect, it } from 'vitest';

import {
  decodeText,
  isFullSnapshot,
  isRefresh,
  isSnapshotSized,
  lineToMessage,
  parseLine,
  parseNdjson,
  splitLines,
  topicCount,
} from '../../src/decode.js';
import { replayLines, replayText } from '../helpers/fixtures.js';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function* chunks<T>(...items: T[]): AsyncGenerator<T> {
  yield* items;
}

describe('parseLine', () => {
  it('parses replay lines and skips everything else', () => {
    expect(parseLine('{"timestamp":5,"relativeTime":"1","data":{"clock":{"ltm":1}}}\r')).toEqual({
      timestamp: 5,
      relativeTime: 1,
      data: { clock: { ltm: 1 } },
    });
    expect(parseLine('  ')).toBeNull();
    expect(parseLine('{"owner":"MotoGP Sports Entertainment Group"}')).toBeNull();
    expect(parseLine('[1]')).toBeNull();
    expect(parseLine('{"timestamp":"x","relativeTime":1,"data":{}}')).toBeNull();
    expect(() => parseLine('{')).toThrow(SyntaxError);
  });

  it('parses the fixture replay', () => {
    const lines = replayLines();
    expect(lines).toHaveLength(19_685);
    expect(replayText().trimEnd().split('\n')).toHaveLength(19_686);
    expect(lineToMessage(lines[0]!)).toEqual({ utc: 1_791_699_599_246, data: lines[0]!.data });
    expect(parseNdjson('\n{"owner":1}\n')).toEqual([]);
  });
});

describe('snapshot detection', () => {
  const six = { session: {}, a: 1, b: 1, c: 1, d: 1, e: 1 };

  it('needs six topics and session, event or refresh', () => {
    expect(isFullSnapshot(six)).toBe(true);
    expect(isFullSnapshot({ ...six, session: undefined, event: {} })).toBe(true);
    const { session: _session, ...five } = six;
    expect(isFullSnapshot({ ...five, f: 1 })).toBe(false);
    expect(isFullSnapshot({ ...five, f: 1, refresh: true })).toBe(true);
    expect(isFullSnapshot({ ...five, refresh: true })).toBe(false);
    expect(isSnapshotSized({ ...five, f: 1 })).toBe(true);
    expect(isRefresh({ refresh: null })).toBe(true);
    expect(topicCount({ refresh: true, a: 1 })).toBe(1);
  });
});

describe('streams', () => {
  it('splits text chunks into lines', async () => {
    expect(await collect(splitLines(chunks('a\nb', 'c\n', '\nd')))).toEqual(['a', 'bc', '', 'd']);
    expect(await collect(splitLines(chunks('a\n')))).toEqual(['a']);
  });

  it('decodes UTF-8 split across chunks', async () => {
    const bytes = new TextEncoder().encode('é');
    expect((await collect(decodeText(chunks(bytes.slice(0, 1), bytes.slice(1))))).join('')).toBe('é');
  });
});
