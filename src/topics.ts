/**
 * MotoGP live timing topics and the shape of their merged state.
 *
 * Field names are Dorna's own abbreviations, kept as they arrive. The meaning
 * of each field was inferred from the timingpass web app and the 2026
 * Indonesian Grand Prix replay; fields marked "unconfirmed" are guesses.
 *
 * Units: times and gaps are in 1/10 000 s (`toMilliseconds` converts them),
 * speeds are km/h.
 */

/** Topics whose state is the latest object received (no merging). */
export const OBJECT_TOPICS = [
  'clock',
  'session',
  'sessionStatus',
  'sessionTime',
  'track',
  'weather',
  'event',
  'settings',
  'season',
  'championship',
  'flashMessage',
] as const;

/** List topics whose rows are matched by `id` instead of `rid`. */
export const ID_KEYED_TOPICS = [
  'bike',
  'entryTeam',
  'team',
  'officialMessage',
  'standingChampionshipConstructorsPosition',
  'standingChampionshipRacerAtTrackPosPosition',
  'standingChampionshipRacersPosition',
  'standingChampionshipTeamsPosition',
  'tyreInfo',
  'infraction',
] as const;

/** `sessionStatus.s` values. `S`, `R` and `C` all count as running in the web app. */
export const SessionStatusCode = {
  NotStarted: 'N',
  Started: 'S',
  Running: 'R',
  /** From the chequered flag (practice and races alike) until the results are final (`F`). */
  Chequered: 'C',
  Finished: 'F',
  Interrupted: 'I',
} as const;
export type SessionStatusCode = (typeof SessionStatusCode)[keyof typeof SessionStatusCode] | (string & {});

/** `record.tp` values. */
export const RecordType = {
  PolePosition: 'P',
  AllTimeTopSpeed: 'S',
  RaceFastestLap: 'R',
  SessionFastestLap: 'F',
  SessionTopSpeed: 'D',
  AllTimeFastestLap: 'A',
} as const;
export type RecordType = (typeof RecordType)[keyof typeof RecordType] | (string & {});

/** `session.k` values the web app treats as races. */
export const RACE_SESSION_KINDS: readonly number[] = [64, 1024];

export interface Clock {
  id: number;
  /** Local time of day at the track, in 1/10 000 s. */
  ltm: number;
}

export interface SessionTime {
  id: number;
  /** Elapsed or remaining session time. Unconfirmed. */
  sessionTime: number;
}

export interface Settings {
  [key: string]: unknown;
}

export interface Season {
  sid: number;
  n: string;
}

export interface Championship {
  id: number;
  /** Championship id; `3` is MotoGP. */
  chid: number;
  n: string;
  /** Short name: `MotoGP`, `Moto2`, `Moto3`. */
  shn: string;
}

export interface TimingEvent {
  eid: number;
  n: string;
  shn: string;
  sn: string;
  snc: string;
}

export interface Session {
  id: number;
  sid: number;
  /** Session kind; see {@link RACE_SESSION_KINDS}. */
  k: number;
  prg: number;
  n: string;
  /** Short name: `FP1`, `Q2`, `SPR`, `RAC`... */
  shn: string;
  /** Start date `YYYYMMDD`, local. */
  ds: string;
  /** Start time `HHMM`, local. */
  ts: string;
  tss: string;
  de: string;
  te: string;
  tes: string;
  mt: number;
  /** Number of laps. */
  nl: number;
  /** Whether standings are combined across sessions. */
  l: boolean;
  utc: number;
  er: boolean;
}

export interface SessionStatus {
  id: number;
  s: SessionStatusCode;
}

export interface Track {
  id: number;
  trid: number;
  n: string;
  /** Place. */
  pl: string;
  /** Nation. */
  nt: string;
  /** IANA time zone of the track. */
  tz: string;
  /** Length in metres. */
  l: number;
  fg: string;
  ms: number;
  /** Left corners. */
  lc: number;
  /** Right corners. */
  rc: number;
}

export interface Weather {
  condition: string;
  airTemp: number;
  groundTemp: number;
  humidity: number;
  windSpeed: number;
  /** Degrees. */
  windDirection: number;
}

export interface FlashMessage {
  id: number;
  mid: string;
  /** Local time `HHMM`. */
  t: string;
  txt: string;
}

export interface OfficialMessage extends FlashMessage {}

export interface Racer {
  id: number;
  /** Racer id, used by every other topic. */
  rid: number;
  /** Bike number. */
  d: string;
  n: string;
  /** Surname, upper case. */
  srn: string;
  shn: string;
  an: string;
  /** Three-letter-style code. */
  tcn: string;
  /** Date of birth `YYYYMMDD`. */
  db: string;
  pb: string;
  nt: string;
  fd: string;
}

export interface Bike {
  id: number;
  bid: number;
  n: string;
}

export interface Team {
  id: number;
  tid: number;
  n: string;
  sn: string;
}

export interface EntryTeam {
  id: number;
  etid: number;
  tid: number;
  n: string;
}

export interface SessionEntry {
  o: number;
  rid: number;
  etid: number;
  bid: number;
  /** Team colour, hex without `#`. */
  c: string;
  /** Text colour on the team colour. */
  tc: string;
}

export interface ChampionshipEntry {
  id: number;
  o: number;
  rid: number;
  etid: number;
  bid: number;
}

/** One row of any `standing*Position` topic (except championship standings). */
export interface StandingRow {
  id?: number;
  /** Order. */
  o: number;
  /** Position; `0` before it is known. */
  p: number;
  rid: number;
  etid: number;
  bid: number;
  /** Time, 1/10 000 s. */
  t: number;
  lap: number;
  /** Average speed, km/h. */
  avgs: number;
  /** Status: `CL` classified, `RT` retired, `NS` not started, `PR` provisional. Unconfirmed. */
  s: string;
  ss: string;
  /** Gap to first, 1/10 000 s. */
  gf: number;
  /** Gap to previous, 1/10 000 s. */
  gp: number;
  /** Gap to first in laps. */
  glf: number;
  /** Gap to previous in laps. */
  glp: number;
  gr: string;
  flag: string;
  pit: boolean;
  bs: number;
  gpp: number;
  /** Promoted from Q1. */
  pq: boolean;
}

export interface ChampionshipStandingRow {
  p: number;
  /** Racer, constructor or team id depending on the topic. */
  id: number;
  /** Points × 10. Unconfirmed. */
  pt: number;
  gf: number;
  gp: number;
}

export interface Lap {
  id: number;
  rid: number;
  /** Lap number. */
  nl: number;
  /** Lap time, 1/10 000 s. */
  lt: number;
  pt: number;
  avgs: number;
  l: boolean;
  /** Personal best. */
  b: boolean;
  /** Fastest overall. */
  f: boolean;
  cb: boolean;
  cf: boolean;
  bs: boolean;
  be: boolean;
  pq: boolean;
  v: boolean;
}

export interface Sector {
  id: number;
  rid: number;
  /** Lap number. */
  ln: number;
  pt: number;
  ps: number;
  pl: boolean;
  /** Sector number, from 1. */
  sn: number;
  v: boolean;
  /** Time, 1/10 000 s. */
  t: number;
  [key: string]: unknown;
}

export interface TrackProgress {
  id: number;
  rid: number;
  lp: number;
  sector: number;
  sp: number;
}

export interface TopSpeed {
  id: number;
  rid: number;
  nl: number;
  topSpeed: number;
  pt: number;
  l: boolean;
  b: boolean;
  f: boolean;
}

export interface RacerTyres {
  id: number;
  rid: number;
  [key: string]: unknown;
}

export interface StartingGridTyres {
  id: number;
  rid: number;
  /** Front supplier, family and compound. */
  fsp: string;
  fsf: string;
  fc: string;
  fa: boolean;
  /** Rear supplier, family and compound. */
  rsp: string;
  rsf: string;
  rc: string;
  ra: boolean;
}

export interface BoxInfo {
  rid: number;
  bt: number;
  tt: number;
  /** `T` on track, `B` in the box. Unconfirmed. */
  stt: string;
  nb: number;
  mtb: number;
  ltb: number;
  lppt: number;
}

export interface MarshallingSector {
  num: number;
  /** Track sectors this marshal post covers. */
  atns: number[];
  /** `none`, `green`, `yellow-waved`, `double-yellow`... */
  stt: string;
  /** ISO time of the last state change. */
  sca: string;
  ris: boolean;
  risc: string;
}

export interface TimingRecord {
  tp: RecordType;
  season: string;
  rid: number;
  /** Time in 1/10 000 s, or speed × 100 for `S` and `D`. */
  v: number;
  ext: string;
}

export interface RacerNotification {
  id: string;
  /** Epoch milliseconds. */
  t: number;
  rid: number;
  /** `track-limits`, ... */
  k: string;
  content: Record<string, unknown>;
  s: string;
  active: boolean;
  updatedAt: number;
}

type Row = Record<string, unknown>;

/** Merged state of each known topic. Unknown topics are `unknown`. */
export interface TopicStates {
  clock: Clock;
  session: Session;
  sessionStatus: SessionStatus;
  sessionTime: SessionTime;
  track: Track;
  weather: Weather;
  event: TimingEvent;
  settings: Settings;
  season: Season;
  championship: Championship;
  flashMessage: FlashMessage;

  /** Laps by racer id, one entry per lap number. */
  lap: Record<string, Lap[]>;
  penalty: Record<string, Row[]>;
  /** Sectors by racer id, then lap number; index `sn - 1`. */
  sector: Record<string, Record<string, Sector[]>>;
  /** Run laps by racer id, run number, then lap number. */
  runLap: Record<string, Record<string, Record<string, Row>>>;
  /** Run summaries by racer id, then run number. */
  runSummary: Record<string, Record<string, Row>>;
  /** Marshal posts by track sector (`atns`), then post number. */
  marshallingSectorState: Record<string, Record<string, MarshallingSector>>;

  record: TimingRecord[];
  racer: Racer[];
  bike: Bike[];
  team: Team[];
  entryTeam: EntryTeam[];
  sessionEntry: SessionEntry[];
  championshipEntry: ChampionshipEntry[];
  officialMessage: OfficialMessage[];
  racerNotification: RacerNotification[];
  boxInfo: BoxInfo[];
  trackProgress: TrackProgress[];
  topSpeed: TopSpeed[];
  racerTyres: RacerTyres[];
  startingGridTyres: StartingGridTyres[];
  startingGridPosition: StandingRow[];
  standingCurrentPosition: StandingRow[];
  standingConsolidatedPosition: StandingRow[];
  standingAtTrackPosPosition: StandingRow[];
  standingAtIP1Position: StandingRow[];
  standingAtIP2Position: StandingRow[];
  standingAtIP3Position: StandingRow[];
  standingSpeedPosition: StandingRow[];
  standingChampionshipRacersPosition: ChampionshipStandingRow[];
  standingChampionshipRacerAtTrackPosPosition: ChampionshipStandingRow[];
  standingChampionshipConstructorsPosition: ChampionshipStandingRow[];
  standingChampionshipTeamsPosition: ChampionshipStandingRow[];
}

export type KnownTopic = keyof TopicStates;
/** A topic name. Known topics autocomplete; any other string is accepted. */
export type Topic = KnownTopic | (string & {});
export type TopicState<T extends Topic> = T extends KnownTopic ? TopicStates[T] : unknown;
