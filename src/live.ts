import { io, type ManagerOptions, type SocketOptions } from 'socket.io-client';

import { isFullSnapshot, isPlainObject, isRefresh, isSnapshotSized, type TimingMessage } from './decode.js';
import { TIMINGPASS_URL, type TokenProvider } from './ondemand.js';

/** MotoGP live timing Socket.IO server. */
export const LIVE_URL = 'https://lts.motogp.com';
/** Socket.IO path of the live timing server. */
export const LIVE_PATH = '/livetiming24-server';

/** The parts of a socket.io-client `Socket` the live client uses. */
export interface SocketLike {
  readonly connected: boolean;
  /** `false` once the socket will not reconnect by itself (for example, the server refused it). */
  readonly active: boolean;
  connect(): unknown;
  disconnect(): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  onAny(listener: (event: string, ...args: unknown[]) => void): unknown;
  readonly io: { on(event: string, listener: (...args: never[]) => void): unknown };
}

export type SocketFactory = (url: string, options: Partial<ManagerOptions & SocketOptions>) => SocketLike;

export type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface LiveClientOptions {
  /** MotoGP account access token (the `DAT` cookie). Asked for again before every reconnect. */
  readonly token?: TokenProvider;
  /** Default {@link LIVE_URL}. */
  readonly url?: string;
  /** Default {@link LIVE_PATH}. */
  readonly path?: string;
  /** Extra handshake headers. Default: an `origin` of the timingpass site. */
  readonly headers?: Record<string, string>;
  /** Reconnection attempts before giving up. Default: unlimited. */
  readonly reconnectionAttempts?: number;
  /** How long {@link LiveClient.connect} waits for the first full snapshot, in ms. Default 30 000. */
  readonly snapshotTimeout?: number;
  /** After a `refresh`, how long to wait for a full snapshot before reconnecting, in ms. Default 5000. */
  readonly refreshTimeout?: number;
  /** Replace the Socket.IO connection, for tests or a custom transport. */
  readonly socketFactory?: SocketFactory;
  /** Clock used to stamp messages that carry no time. Default `Date.now`. */
  readonly now?: () => number;
}

type MessageListener = (message: TimingMessage) => void;
type StatusListener = (status: LiveStatus, error?: Error) => void;
type EventListener = (event: string, args: readonly unknown[]) => void;

/**
 * Live MotoGP, Moto2 or Moto3 timing over Socket.IO: whichever session is on
 * track. Every `snapshot` event becomes one {@link TimingMessage}.
 *
 * {@link LiveClient.connect} resolves once the first full snapshot has
 * arrived. The client asks for a full snapshot (`update_data`) on every
 * connect, and again when the server sends `refresh`; if none follows in
 * time it reconnects.
 */
export class LiveClient {
  readonly #socket: SocketLike;
  readonly #now: () => number;
  readonly #refreshTimeout: number;
  readonly #messageListeners = new Set<MessageListener>();
  readonly #statusListeners = new Set<StatusListener>();
  readonly #eventListeners = new Set<EventListener>();
  readonly #queues = new Set<MessageQueue>();
  #status: LiveStatus = 'connecting';
  #closing = false;
  #awaitingSnapshot = true;
  #refreshTimer: NodeJS.Timeout | undefined;
  #ready: { resolve: () => void; reject: (error: Error) => void } | undefined;

  private constructor(socket: SocketLike, options: LiveClientOptions) {
    this.#socket = socket;
    this.#now = options.now ?? Date.now;
    this.#refreshTimeout = options.refreshTimeout ?? 5_000;
  }

  /** Connect and wait for the first full snapshot. */
  static async connect(options: LiveClientOptions = {}): Promise<LiveClient> {
    const token = options.token;
    const socket = (options.socketFactory ?? createSocket)(options.url ?? LIVE_URL, {
      path: options.path ?? LIVE_PATH,
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: options.reconnectionAttempts ?? Infinity,
      transports: ['websocket'],
      query: { orgdevice: 'web' },
      extraHeaders: options.headers ?? { origin: TIMINGPASS_URL },
      auth: (cb) => {
        resolveToken(token).then(
          (value) => cb(value ? { token: value } : {}),
          () => cb({}),
        );
      },
    });
    const client = new LiveClient(socket, options);
    await client.#start(options.snapshotTimeout ?? 30_000);
    return client;
  }

  /** Current connection status. */
  get status(): LiveStatus {
    return this.#status;
  }

  /** Call `listener` with every message. Returns an unsubscribe function. */
  subscribeMessages(listener: MessageListener): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  /** Call `listener` on every status change. Returns an unsubscribe function. */
  subscribeStatus(listener: StatusListener): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /**
   * Call `listener` with every Socket.IO event the server sends, `snapshot`
   * included, as it arrives. Useful for events this library does not handle
   * yet, such as `record`. Returns an unsubscribe function.
   */
  subscribeEvents(listener: EventListener): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /**
   * Every message from now on as an async iterator. It ends when the client
   * closes; breaking out of the loop stops buffering.
   */
  messages(): AsyncIterableIterator<TimingMessage> {
    const queue = new MessageQueue(() => this.#queues.delete(queue));
    if (this.#status === 'closed') queue.end();
    else this.#queues.add(queue);
    return queue;
  }

  /** Ask the server for a full snapshot. */
  requestSnapshot(): void {
    if (this.#socket.connected) this.#socket.emit('update_data');
  }

  /** Close the connection. */
  close(): Promise<void> {
    if (this.#status !== 'closed') this.#shutdown();
    return Promise.resolve();
  }

  #start(snapshotTimeout: number): Promise<void> {
    const socket = this.#socket;
    socket.on('snapshot', (payload: unknown) => this.#onSnapshot(payload));
    socket.onAny((event, ...args) => {
      for (const listener of [...this.#eventListeners]) listener(event, args);
    });
    socket.on('connect', () => {
      this.#setStatus('connected');
      this.requestSnapshot();
    });
    socket.on('disconnect', (reason: string) => {
      if (this.#closing) return;
      this.#setStatus('reconnecting');
      // Socket.IO does not reconnect by itself after a server-side disconnect.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', (error: Error) => {
      if (!socket.active) this.#fail(error);
    });
    socket.io.on('reconnect_failed', () => this.#fail(new Error('Live timing reconnection failed.')));

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail(new Error(`No live timing snapshot within ${snapshotTimeout} ms.`));
      }, snapshotTimeout);
      const settle = () => {
        clearTimeout(timer);
        this.#ready = undefined;
      };
      this.#ready = {
        resolve: () => {
          settle();
          resolve();
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      };
      socket.connect();
    });
  }

  #onSnapshot(payload: unknown): void {
    const message = this.#toMessage(payload);
    if (!message) return;
    const { data } = message;
    if (isFullSnapshot(data) || (this.#awaitingSnapshot && isSnapshotSized(data))) {
      this.#awaitingSnapshot = false;
      this.#clearRefreshTimer();
    } else if (isRefresh(data)) {
      this.#awaitingSnapshot = true;
      this.requestSnapshot();
      this.#clearRefreshTimer();
      // Cleared by the next full snapshot or by close().
      this.#refreshTimer = setTimeout(() => {
        this.#socket.disconnect();
        this.#socket.connect();
      }, this.#refreshTimeout);
    }
    this.#emit(message);
    if (!this.#awaitingSnapshot) this.#ready?.resolve();
  }

  /** A `snapshot` payload is the topic map itself, or (defensively) `{ timestamp, data }`. */
  #toMessage(payload: unknown): TimingMessage | null {
    let value = payload;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!isPlainObject(value)) return null;
    const timestamp = Number(value['timestamp']);
    if (isPlainObject(value['data']) && Number.isFinite(timestamp)) return { utc: timestamp, data: value['data'] };
    return { utc: this.#now(), data: value };
  }

  #emit(message: TimingMessage): void {
    for (const queue of this.#queues) queue.push(message);
    for (const listener of [...this.#messageListeners]) listener(message);
  }

  #fail(error: Error): void {
    if (this.#status === 'closed') return;
    const ready = this.#ready;
    this.#shutdown(error);
    ready?.reject(error);
  }

  #shutdown(error?: Error): void {
    this.#closing = true;
    this.#clearRefreshTimer();
    this.#socket.disconnect();
    this.#setStatus('closed', error);
  }

  #clearRefreshTimer(): void {
    clearTimeout(this.#refreshTimer);
    this.#refreshTimer = undefined;
  }

  #setStatus(status: LiveStatus, error?: Error): void {
    if (this.#status === status && error === undefined) return;
    this.#status = status;
    if (status === 'closed') {
      for (const queue of this.#queues) queue.end();
      this.#queues.clear();
    }
    for (const listener of [...this.#statusListeners]) listener(status, error);
  }
}

function createSocket(url: string, options: Partial<ManagerOptions & SocketOptions>): SocketLike {
  return io(url, options) as unknown as SocketLike;
}

async function resolveToken(token: TokenProvider | undefined): Promise<string | undefined> {
  const value = typeof token === 'function' ? await token() : token;
  return value?.replace(/^bearer /i, '');
}

/** Unbounded async queue behind {@link LiveClient.messages}. */
class MessageQueue implements AsyncIterableIterator<TimingMessage> {
  readonly #buffer: TimingMessage[] = [];
  readonly #waiting: ((result: IteratorResult<TimingMessage>) => void)[] = [];
  readonly #onDone: () => void;
  #done = false;

  constructor(onDone: () => void) {
    this.#onDone = onDone;
  }

  push(message: TimingMessage): void {
    const waiter = this.#waiting.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.#buffer.push(message);
  }

  end(): void {
    this.#done = true;
    for (const waiter of this.#waiting.splice(0)) waiter({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<TimingMessage>> {
    const message = this.#buffer.shift();
    if (message) return Promise.resolve({ value: message, done: false });
    if (this.#done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  return(): Promise<IteratorResult<TimingMessage>> {
    this.#buffer.length = 0;
    this.end();
    this.#onDone();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<TimingMessage> {
    return this;
  }
}
