import { afterEach, describe, expect, it, vi } from 'vitest';

import { LIVE_PATH, LIVE_URL, LiveClient, type LiveClientOptions, type SocketLike } from '../../src/live.js';
import { Timeline } from '../../src/timeline.js';
import { MID_SNAPSHOT_INDEX, replayLines } from '../helpers/fixtures.js';

/** How the fake calls a listener; the interface types them as `never[]` so any signature fits. */
type Listener = (...args: unknown[]) => void;
type Handler = (...args: never[]) => void;

/** Plays the server side of a Socket.IO connection. */
class FakeSocket implements SocketLike {
  connected = false;
  active = true;
  /** Answer `update_data` with this full snapshot (or nothing when `null`). */
  snapshot: unknown = replayLines()[MID_SNAPSHOT_INDEX]!.data;
  readonly emitted: unknown[][] = [];
  readonly handlers = new Map<string, Listener>();
  readonly ioHandlers = new Map<string, Listener>();
  any: Listener | undefined;
  readonly io = { on: (event: string, listener: Handler) => this.ioHandlers.set(event, listener as Listener) };

  constructor(readonly url: string, readonly options: Record<string, unknown>) {}

  connect = vi.fn(() => {
    this.connected = true;
    this.handlers.get('connect')?.();
  });

  disconnect = vi.fn(() => {
    this.connected = false;
  });

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push([event, ...args]);
    if (event === 'update_data' && this.snapshot !== null) queueMicrotask(() => this.send('snapshot', this.snapshot));
  }

  on(event: string, listener: Handler): void {
    this.handlers.set(event, listener as Listener);
  }

  onAny(listener: (event: string, ...args: unknown[]) => void): void {
    this.any = listener as Listener;
  }

  /** An event from the server. */
  send(event: string, ...args: unknown[]): void {
    this.any?.(event, ...args);
    this.handlers.get(event)?.(...args);
  }

  /** The auth payload the client would send on the next handshake. */
  auth(): Promise<object> {
    const auth = this.options['auth'] as (cb: (data: object) => void) => void;
    return new Promise((resolve) => auth(resolve));
  }

  updateRequests(): number {
    return this.emitted.filter(([event]) => event === 'update_data').length;
  }
}

async function connect(options: LiveClientOptions = {}, setup: (socket: FakeSocket) => void = () => undefined) {
  let socket: FakeSocket | undefined;
  const client = await LiveClient.connect({
    now: () => 42,
    ...options,
    socketFactory: (url, socketOptions) => {
      socket = new FakeSocket(url, socketOptions as Record<string, unknown>);
      setup(socket);
      return socket;
    },
  });
  return { client, socket: socket! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveClient', () => {
  it('connects like the web app and resolves on the first full snapshot', async () => {
    const { client, socket } = await connect({ token: 'Bearer abc' });
    expect(socket.url).toBe(LIVE_URL);
    expect(socket.options).toMatchObject({
      path: LIVE_PATH,
      autoConnect: false,
      transports: ['websocket'],
      query: { orgdevice: 'web' },
      extraHeaders: { origin: 'https://timingpass.motogp.com' },
      reconnectionAttempts: Infinity,
    });
    expect(await socket.auth()).toEqual({ token: 'abc' });
    expect(socket.updateRequests()).toBe(1);
    expect(client.status).toBe('connected');
    await client.close();
    expect(client.status).toBe('closed');
    expect(socket.disconnect).toHaveBeenCalled();
    await client.close();
  });

  it('asks the token provider on every handshake', async () => {
    let calls = 0;
    const { socket } = await connect({ token: () => Promise.resolve(`t${++calls}`) });
    expect(await socket.auth()).toEqual({ token: 't1' });
    expect(await socket.auth()).toEqual({ token: 't2' });
    const none = await connect({ token: () => undefined, url: 'https://example.test', path: '/p', headers: {} });
    expect(await none.socket.auth()).toEqual({});
    expect(none.socket.options).toMatchObject({ path: '/p', extraHeaders: {} });
    const failing = await connect({ token: () => Promise.reject(new Error('no token')), reconnectionAttempts: 3 });
    expect(await failing.socket.auth()).toEqual({});
    expect(failing.socket.options['reconnectionAttempts']).toBe(3);
  });

  it('delivers snapshot events as messages', async () => {
    const { client, socket } = await connect();
    const received: unknown[] = [];
    const events: unknown[] = [];
    client.subscribeMessages((message) => received.push(message));
    const off = client.subscribeEvents((event, args) => events.push([event, args]));
    socket.send('snapshot', { weather: { airTemp: 30 } });
    socket.send('snapshot', '{"clock":{"ltm":5}}');
    socket.send('snapshot', { timestamp: 7, data: { clock: { ltm: 6 } } });
    socket.send('snapshot', 'not json');
    socket.send('snapshot', [1]);
    socket.send('record', { tp: 'P' });
    off();
    socket.send('record', { tp: 'S' });
    expect(received).toEqual([
      { utc: 42, data: { weather: { airTemp: 30 } } },
      { utc: 42, data: { clock: { ltm: 5 } } },
      { utc: 7, data: { clock: { ltm: 6 } } },
    ]);
    expect(events).toHaveLength(6);
    expect(events.at(-1)).toEqual(['record', [{ tp: 'P' }]]);
  });

  it('feeds a live timeline', async () => {
    const { client, socket } = await connect();
    using timeline = Timeline.fromLive(client);
    socket.send('snapshot', { sessionStatus: { id: 1, s: 'S' } });
    expect(timeline.latest()['sessionStatus']).toEqual({ id: 1, s: 'S' });
  });

  it('answers refresh with a snapshot request, then reconnects if none comes', async () => {
    vi.useFakeTimers();
    const { client, socket } = await connect({ refreshTimeout: 100 });
    socket.snapshot = null;
    socket.send('snapshot', { refresh: true });
    expect(socket.updateRequests()).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(2);

    socket.send('snapshot', { refresh: true });
    socket.send('snapshot', { refresh: true, ...(replayLines()[0]!.data as object) });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.connect).toHaveBeenCalledTimes(2);

    socket.send('snapshot', { refresh: true });
    await client.close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it('accepts a snapshot-sized message while waiting after a refresh', async () => {
    vi.useFakeTimers();
    const { socket } = await connect({ refreshTimeout: 100 });
    socket.snapshot = null;
    socket.send('snapshot', { refresh: true });
    socket.send('snapshot', { a: [], b: [], c: [], d: [], e: [], f: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('tracks disconnects and reconnects after a server disconnect', async () => {
    const { client, socket } = await connect();
    const statuses: string[] = [];
    client.subscribeStatus((status) => statuses.push(status));
    socket.handlers.get('disconnect')!('transport close');
    expect(client.status).toBe('reconnecting');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    socket.handlers.get('disconnect')!('io server disconnect');
    expect(socket.connect).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['reconnecting', 'connected']);
    socket.handlers.get('connect_error')!(new Error('retrying'));
    expect(client.status).toBe('connected');
    await client.close();
    socket.handlers.get('disconnect')!('io client disconnect');
    expect(statuses.at(-1)).toBe('closed');
  });

  it('closes when the server refuses the connection or retries run out', async () => {
    const refused = connect({}, (socket) => {
      socket.snapshot = null;
      socket.connect.mockImplementation(() => {
        socket.active = false;
        socket.handlers.get('connect_error')?.(new Error('unauthorized'));
      });
    });
    await expect(refused).rejects.toThrow('unauthorized');

    const { client, socket } = await connect();
    const errors: (Error | undefined)[] = [];
    client.subscribeStatus((_status, error) => errors.push(error));
    const iterator = client.messages();
    socket.ioHandlers.get('reconnect_failed')!();
    expect(client.status).toBe('closed');
    expect(errors[0]?.message).toBe('Live timing reconnection failed.');
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(await client.messages().next()).toEqual({ value: undefined, done: true });
    socket.ioHandlers.get('reconnect_failed')!();
  });

  it('times out without a full snapshot', async () => {
    vi.useFakeTimers();
    const pending = connect({ snapshotTimeout: 50 }, (socket) => {
      socket.snapshot = { weather: {} };
    });
    const result = expect(pending).rejects.toThrow('No live timing snapshot within 50 ms.');
    await vi.advanceTimersByTimeAsync(50);
    await result;
  });

  it('iterates messages until the client closes', async () => {
    const { client, socket } = await connect();
    const iterator = client.messages();
    socket.send('snapshot', { weather: { airTemp: 1 } });
    expect(await iterator.next()).toEqual({ value: { utc: 42, data: { weather: { airTemp: 1 } } }, done: false });
    const waiting = iterator.next();
    socket.send('snapshot', { weather: { airTemp: 2 } });
    expect((await waiting).value).toEqual({ utc: 42, data: { weather: { airTemp: 2 } } });
    const last = iterator.next();
    await client.close();
    expect(await last).toEqual({ value: undefined, done: true });

    const other = await connect();
    const loop = other.client.messages();
    expect(loop[Symbol.asyncIterator]()).toBe(loop);
    other.socket.send('snapshot', { weather: {} });
    expect(await loop.return!()).toEqual({ value: undefined, done: true });
    other.client.requestSnapshot();
    other.socket.connected = false;
    other.client.requestSnapshot();
    expect(other.socket.updateRequests()).toBe(2);
  });

  it('uses socket.io-client by default', async () => {
    const pending = LiveClient.connect({ url: 'http://127.0.0.1:1', snapshotTimeout: 200, reconnectionAttempts: 0 });
    await expect(pending).rejects.toThrow();
  });
});
