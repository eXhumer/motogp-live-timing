import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lineToMessage } from '../../src/decode.js';
import { Recorder } from '../../src/recorder.js';
import { loadRecording, readText } from '../../src/replay.js';
import { REPLAY_FILE, replayLines } from '../helpers/fixtures.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'motogp-lt-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Recorder', () => {
  it('writes the replay format and reads it back', async () => {
    const path = join(dir, 'nested', 'race.ndjson');
    const messages = replayLines().slice(0, 50).map(lineToMessage);
    {
      await using recorder = await Recorder.create(path);
      expect(recorder.start).toBeUndefined();
      for (const message of messages) recorder.write(message);
      expect(recorder.start).toBe(messages[0]!.utc);
    }
    const first = JSON.parse((await readFile(path, 'utf8')).split('\n')[0]!) as Record<string, unknown>;
    expect(first['relativeTime']).toBe(0);
    const progress: number[] = [];
    const timeline = await loadRecording(path, { checkpointInterval: 1000, onProgress: (n) => progress.push(n) });
    expect(timeline.messages()).toEqual(messages);
    expect(progress).toEqual([50]);
  });

  it('honours a start, rejects writes after close and reports write errors', async () => {
    const recorder = await Recorder.create(join(dir, 'a.ndjson'), { start: 0 });
    recorder.write({ utc: 10, data: {} });
    await recorder.close();
    await recorder.close();
    expect(JSON.parse(await readFile(join(dir, 'a.ndjson'), 'utf8'))).toEqual({ timestamp: 10, relativeTime: 10, data: {} });
    expect(() => recorder.write({ utc: 11, data: {} })).toThrow('Recorder is closed.');

    // Opening a directory as a file fails on every platform.
    const broken = await Recorder.create(dir);
    broken.write({ utc: 1, data: {} });
    await expect(broken.close()).rejects.toThrow();
  });
});

describe('loadRecording', () => {
  it('reads a gzipped on-demand download', async () => {
    const timeline = await loadRecording(REPLAY_FILE);
    expect(timeline.size).toBe(19_685);
    expect((await readText(REPLAY_FILE)).startsWith('{"timestamp"')).toBe(true);
  });
});
