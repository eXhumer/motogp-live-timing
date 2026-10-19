import { request, type Dispatcher } from 'undici';

import { decodeText, lineToMessage, type OnDemandLine, parseLine, splitLines, type TimingMessage } from './decode.js';

/** Base URL of the timingpass web app and its API. */
export const TIMINGPASS_URL = 'https://timingpass.motogp.com';

export type EventStatus = 'NOT-STARTED' | 'IN-PROGRESS' | 'FINISHED' | (string & {});

/** A session of an event (`broadcasts` / `sessions` in the API). */
export interface Broadcast {
  id: string;
  name: string;
  /** `FP1`, `FP2`, `PR`, `Q1`, `Q2`, `SPR`, `WUP`, `RAC`, `RAC2`. */
  shortname: string;
  /** Local time with offset, e.g. `2026-10-11T15:00:00+0800`. */
  date_start: string;
  date_end: string;
  remain?: number;
  type: string;
  /** `PRACTICE`, `QUALIFYING`, `WARM_UP` or `RACE`. */
  kind: string;
  status: EventStatus;
  /** `MotoGP`, `Moto2` or `Moto3`. */
  category: string;
  num_laps?: number;
  gp_day?: number;
  is_live?: boolean;
  /** On-demand replay file, for {@link OnDemandClient.lines}. Present once the session has finished. */
  file_id?: string;
}

export interface Circuit {
  name: string;
  country: string;
  iso_code: string;
  region: string;
  [key: string]: unknown;
}

export interface EventInfo {
  id: string;
  name: string;
  shortname: string;
  date_start: string;
  date_end: string;
  /** Seconds until the event starts. */
  remain: number;
  type: string;
  kind: string;
  status: EventStatus;
  additional_name: string;
  url: string;
  hashtag: string;
  season: number;
  assets: { type: string; path: string }[];
  circuit?: Circuit;
  broadcasts?: Broadcast[];
}

/** A finished session with a replay file. */
export interface OnDemandBroadcast extends Broadcast {
  file_id: string;
}

/** An event in the replay calendar: every session of every class, each with a replay file. */
export interface OnDemandEvent extends EventInfo {
  broadcasts: OnDemandBroadcast[];
}

/** `/api/getSchedule/`. */
export interface Schedule {
  event: EventInfo;
  sessions: Broadcast[];
  [key: string]: unknown;
}

/** A `{ main, secondary }` picture pair; either may be `null`. */
export interface PicturePair {
  main: string | null;
  secondary: string | null;
}

export interface RiderTeam {
  id: string;
  name: string;
  /**
   * Dorna team id. Usually the timing feed's `team.tid`, but not always
   * (Trackhouse is 46 here and 47 in the 2026 feed).
   */
  legacy_id: number;
  /** `Official`, ... */
  type: string;
  /** `#rrggbb`. */
  color: string;
  text_color: string;
  background_picture: string | null;
  picture: string | null;
  /** `legacy_id` is the timing feed's `bike.bid`. */
  constructor: { id: string; name: string; legacy_id: number };
  /** `legacy_id` is the timing feed's `championship.chid` (3 is MotoGP). `null` for older seasons. */
  category: { id: string; name: string; legacy_id: number } | null;
}

/** A rider's season in their career. */
export interface RiderCareer {
  /** Bike number. */
  number: number | null;
  sponsored_team: string | null;
  team: RiderTeam | null;
  pictures: {
    profile: PicturePair;
    bike: PicturePair;
    helmet: PicturePair;
    number: string | null;
    portrait: string | null;
  };
}

/** `/api/getRider/{rid}`: a rider profile from the MotoGP results database. */
export interface RiderProfile {
  /** Pulselive rider id (`api.pulselive.motogp.com/motogp/v1/riders/{id}`). */
  id: string;
  /** The timing feed's racer id (`rid`). */
  legacy_id: number;
  name: string;
  surname: string;
  nickname: string | null;
  country: { iso: string; name: string; flag: string };
  published: boolean;
  /**
   * The requested season, or the current one without `season`. A season
   * before the rider's career also returns the current one.
   */
  career: RiderCareer;
}

/** Bearer token, or a function returning the current one. */
export type TokenProvider = string | (() => string | undefined | Promise<string | undefined>);

export interface OnDemandClientOptions {
  /**
   * MotoGP account access token (the `DAT` cookie, or `access_token` from
   * {@link login}) of an account with a Timing Pass. Replays answer HTTP 401
   * without one. The pass is an active licence on the account
   * (`api.motogp.com/perms/me`), not a claim in the token.
   */
  readonly token?: TokenProvider;
  /** Default {@link TIMINGPASS_URL}. */
  readonly baseUrl?: string;
  /** undici dispatcher for every request (proxy, mock, shared pool). */
  readonly dispatcher?: Dispatcher;
  /** Extra headers for every request. */
  readonly headers?: Record<string, string>;
}

/** Any unexpected HTTP status from the timingpass API. */
export class OnDemandHttpError extends Error {
  override readonly name = 'OnDemandHttpError';
  constructor(readonly url: string, readonly statusCode: number) {
    super(`Timingpass request failed (HTTP ${statusCode}): ${url}`);
  }
}

/**
 * Client for the timingpass API: the schedule, live status and on-demand
 * replays. Each replay is one NDJSON file per session.
 */
export class OnDemandClient {
  readonly #baseUrl: string;
  readonly #token: TokenProvider | undefined;
  readonly #dispatcher: Dispatcher | undefined;
  readonly #headers: Record<string, string>;

  constructor(options: OnDemandClientOptions = {}) {
    this.#baseUrl = options.baseUrl ?? TIMINGPASS_URL;
    this.#token = options.token;
    this.#dispatcher = options.dispatcher;
    this.#headers = options.headers ?? {};
  }

  /** Absolute URL of an API path. */
  url(path: string): string {
    return new URL(path, this.#baseUrl).toString();
  }

  /** The next or current event and its sessions (`/api/getIsLive`). */
  isLive(): Promise<EventInfo> {
    return this.#json('/api/getIsLive');
  }

  /** The next or current event's schedule (`/api/getSchedule/`). */
  schedule(): Promise<Schedule> {
    return this.#json('/api/getSchedule/');
  }

  /** The most recent event with replays. */
  lastOnDemand(): Promise<OnDemandEvent> {
    return this.#json('/api/ondemand/last');
  }

  /** Every event of the season with replays, oldest first (`/api/ondemand/calendar`). */
  calendar(): Promise<OnDemandEvent[]> {
    return this.#json('/api/ondemand/calendar');
  }

  /**
   * A rider's profile by racer id (`rid`), with their team and pictures for
   * `season` (default: the current one). `undefined` for an unknown id. No
   * token needed.
   */
  async rider(rid: number, season?: number): Promise<RiderProfile | undefined> {
    const body = await this.#json<unknown>(`/api/getRider/${rid}${season ? `?season=${season}` : ''}`);
    // The API answers with a one-element array, or `{}` when the id is unknown.
    return Array.isArray(body) ? (body[0] as RiderProfile | undefined) : undefined;
  }

  /** Lines of a replay file, read as the response streams in. */
  async *lines(fileId: string): AsyncGenerator<OnDemandLine> {
    const body = await this.#open(`/api/ondemand/${encodeURIComponent(fileId)}`);
    for await (const text of splitLines(decodeText(body))) {
      const line = parseLine(text);
      if (line) yield line;
    }
  }

  /** A replay as messages. */
  async *messages(fileId: string): AsyncGenerator<TimingMessage> {
    for await (const line of this.lines(fileId)) yield lineToMessage(line);
  }

  async #json<T>(path: string): Promise<T> {
    const body = await this.#open(path);
    return (await body.json()) as T;
  }

  async #open(path: string): Promise<Dispatcher.ResponseData['body']> {
    const url = this.url(path);
    const token = typeof this.#token === 'function' ? await this.#token() : this.#token;
    const response = await request(url, {
      headers: { ...this.#headers, ...(token ? { authorization: bearer(token) } : {}) },
      ...(this.#dispatcher ? { dispatcher: this.#dispatcher } : {}),
    });
    if (response.statusCode === 200) return response.body;
    await response.body.dump();
    throw new OnDemandHttpError(url, response.statusCode);
  }
}

function bearer(token: string): string {
  return /^bearer /i.test(token) ? token : `Bearer ${token}`;
}
