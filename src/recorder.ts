import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { finished } from 'node:stream/promises';

import type { TimingMessage } from './decode.js';

export interface RecorderOptions {
  /**
   * UTC instant `relativeTime` counts from. Default: the first recorded
   * message's time.
   */
  readonly start?: number;
}

/**
 * Writes messages to an NDJSON file in the on-demand replay format, one
 * `{"timestamp", "relativeTime", "data"}` line per message, so
 * {@link loadRecording} reads recordings and downloaded replays alike.
 */
export class Recorder {
  readonly #stream: WriteStream;
  #start: number | undefined;
  #closed = false;
  #error: unknown;

  private constructor(stream: WriteStream, start: number | undefined) {
    this.#stream = stream;
    this.#start = start;
    // Write errors surface from close(); without a listener they would crash the process.
    stream.on('error', (error) => {
      this.#error ??= error;
    });
  }

  /** Create the parent folder (if needed) and a recorder appending to `path`. */
  static async create(path: string, options: RecorderOptions = {}): Promise<Recorder> {
    await mkdir(dirname(path), { recursive: true });
    return new Recorder(createWriteStream(path, { flags: 'a' }), options.start);
  }

  /** UTC instant `relativeTime` counts from, once known. */
  get start(): number | undefined {
    return this.#start;
  }

  /** Append one message. */
  write(message: TimingMessage): void {
    if (this.#closed) throw new Error('Recorder is closed.');
    this.#start ??= message.utc;
    const line = { timestamp: message.utc, relativeTime: message.utc - this.#start, data: message.data };
    this.#stream.write(`${JSON.stringify(line)}\n`);
  }

  /** Finish the file. Rejects with the first write error, if any happened. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#stream.end();
    try {
      await finished(this.#stream);
    } catch (error) {
      this.#error ??= error;
    }
    if (this.#error !== undefined) throw this.#error;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
