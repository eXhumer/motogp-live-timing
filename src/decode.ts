/**
 * One update from either source: the topics that changed at one instant.
 *
 * `data` maps topic names to rows, exactly as Dorna sends them: an object for
 * single-value topics (`weather`, `session`), an array of rows for the rest.
 * A message is either a delta or a full snapshot ({@link isFullSnapshot}).
 */
export interface TimingMessage {
  /** When the update was stamped, as UTC epoch milliseconds. */
  readonly utc: number;
  readonly data: Readonly<Record<string, unknown>>;
}

/** One line of an on-demand replay file (NDJSON). */
export interface OnDemandLine {
  /** UTC epoch milliseconds. */
  readonly timestamp: number;
  /** Milliseconds since the start of the file. */
  readonly relativeTime: number;
  readonly data: Readonly<Record<string, unknown>>;
}

/** Key that asks the client to drop its state and wait for a full snapshot. */
export const REFRESH_KEY = 'refresh';

/** Number of topics above which a message is a full snapshot rather than a delta. */
const FULL_SNAPSHOT_MIN_TOPICS = 6;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a message carries the `refresh` marker. */
export function isRefresh(data: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(data, REFRESH_KEY);
}

/** Number of topics in a message, not counting `refresh`. */
export function topicCount(data: Readonly<Record<string, unknown>>): number {
  return Object.keys(data).length - (isRefresh(data) ? 1 : 0);
}

/**
 * Whether a message replaces the whole state. The web app treats a message
 * with more than five topics as a full snapshot when it also has `session` or
 * `event`, or carries `refresh`.
 */
export function isFullSnapshot(data: Readonly<Record<string, unknown>>): boolean {
  return (
    topicCount(data) >= FULL_SNAPSHOT_MIN_TOPICS &&
    (isRefresh(data) || Object.hasOwn(data, 'session') || Object.hasOwn(data, 'event'))
  );
}

/** Whether a message is big enough to be a full snapshot while one is awaited. */
export function isSnapshotSized(data: Readonly<Record<string, unknown>>): boolean {
  return topicCount(data) >= FULL_SNAPSHOT_MIN_TOPICS;
}

/**
 * Parse one replay line. Returns `null` for blank lines and for lines that are
 * not timing updates, such as the trailing `{"owner": ...}` line.
 */
export function parseLine(line: string): OnDemandLine | null {
  const text = line.trim();
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!isPlainObject(value) || !isPlainObject(value['data'])) return null;
  const timestamp = Number(value['timestamp']);
  const relativeTime = Number(value['relativeTime']);
  if (!Number.isFinite(timestamp) || !Number.isFinite(relativeTime)) return null;
  return { timestamp, relativeTime, data: value['data'] };
}

export function lineToMessage(line: OnDemandLine): TimingMessage {
  return { utc: line.timestamp, data: line.data };
}

/** Parse a whole replay file. */
export function parseNdjson(text: string): OnDemandLine[] {
  return text.split('\n').map(parseLine).filter((line) => line !== null);
}

/**
 * Split an async stream of text chunks into lines. A final line without a
 * trailing newline is still yielded.
 */
export async function* splitLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let rest = '';
  for await (const chunk of chunks) {
    rest += chunk;
    let index: number;
    while ((index = rest.indexOf('\n')) !== -1) {
      yield rest.slice(0, index);
      rest = rest.slice(index + 1);
    }
  }
  if (rest) yield rest;
}

/** Decode a stream of UTF-8 bytes into text chunks. */
export async function* decodeText(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of body) yield decoder.decode(chunk, { stream: true });
  yield decoder.decode();
}
