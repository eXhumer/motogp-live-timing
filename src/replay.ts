import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { lineToMessage, type OnDemandLine, parseNdjson, type TimingMessage } from './decode.js';
import type { OnDemandClient } from './ondemand.js';
import { Timeline, type TimelineOptions } from './timeline.js';

export interface ReplayOptions extends Pick<TimelineOptions, 'checkpointInterval'> {
  /** Called after each batch of lines is inserted, with the total so far. */
  readonly onProgress?: (lines: number) => void;
}

/** Lines inserted into the timeline at a time while a replay downloads. */
const BATCH_SIZE = 1000;

/**
 * Download an on-demand replay into a {@link Timeline}. Lines are inserted in
 * batches as the file streams in, so the start of the session is usable
 * before the download finishes.
 */
export async function loadOnDemand(
  client: OnDemandClient,
  fileId: string,
  options: ReplayOptions = {},
): Promise<Timeline> {
  const timeline = createTimeline(options);
  let batch: TimingMessage[] = [];
  let count = 0;
  const flush = () => {
    timeline.insert(batch);
    count += batch.length;
    batch = [];
    options.onProgress?.(count);
  };
  for await (const message of client.messages(fileId)) {
    batch.push(message);
    if (batch.length >= BATCH_SIZE) flush();
  }
  if (batch.length > 0) flush();
  return timeline;
}

/**
 * Load an NDJSON file in the replay format (written by `Recorder`, or a saved
 * on-demand download) into a {@link Timeline}. Gzipped files are inflated.
 */
export async function loadRecording(path: string, options: ReplayOptions = {}): Promise<Timeline> {
  const timeline = timelineFromLines(parseNdjson(await readText(path)), options);
  options.onProgress?.(timeline.size);
  return timeline;
}

/** Build a {@link Timeline} from parsed replay lines. */
export function timelineFromLines(lines: readonly OnDemandLine[], options: ReplayOptions = {}): Timeline {
  const timeline = createTimeline(options);
  timeline.insert(lines.map(lineToMessage));
  return timeline;
}

function createTimeline(options: ReplayOptions): Timeline {
  return new Timeline(options.checkpointInterval === undefined ? {} : { checkpointInterval: options.checkpointInterval });
}

/** Read a file as UTF-8, inflating it first if it is gzipped. */
export async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  return (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8');
}
