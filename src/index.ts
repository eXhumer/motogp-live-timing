export {
  activePermissions,
  hasTimingPass,
  login,
  LOGIN_CLIENT_ID,
  LOGIN_URL,
  LoginError,
  ORIGIN_CLIENT_ID,
  PERMISSIONS_URL,
  PermissionsError,
  refreshToken,
  TIMING_PASS_LICENCE_ID,
  timingPassLicenceId,
  tokenClaims,
  tokenExpiry,
  MotoGPAuth,
  NotSignedInError,
} from './auth.js';
export type {
  LicenceIdOptions,
  LoginOptions,
  MotoGPAuthOptions,
  Permission,
  PermissionsOptions,
  RefreshTokenOptions,
  TimingPassOptions,
  TokenClaims,
  TokenResponse,
} from './auth.js';

export {
  decodeText,
  isFullSnapshot,
  isPlainObject,
  isRefresh,
  isSnapshotSized,
  lineToMessage,
  parseLine,
  parseNdjson,
  REFRESH_KEY,
  splitLines,
  topicCount,
} from './decode.js';
export type { OnDemandLine, TimingMessage } from './decode.js';

export { LIVE_PATH, LIVE_URL, LiveAuthError, LiveClient, NOT_AUTHORISED } from './live.js';
export type { LiveClientOptions, LiveStatus, SocketFactory, SocketLike } from './live.js';

export { applyRows, rowKey } from './merge.js';

export { OnDemandClient, OnDemandHttpError, TIMINGPASS_URL } from './ondemand.js';
export type {
  Broadcast,
  Circuit,
  EventInfo,
  EventStatus,
  OnDemandBroadcast,
  OnDemandClientOptions,
  OnDemandEvent,
  PicturePair,
  RiderCareer,
  RiderProfile,
  RiderTeam,
  Schedule,
  TokenProvider,
} from './ondemand.js';

export { Recorder } from './recorder.js';
export type { RecorderOptions } from './recorder.js';

export { loadOnDemand, loadRecording, readText, timelineFromLines } from './replay.js';
export type { ReplayOptions } from './replay.js';

export { applyMessage, EMPTY_STATE, getTopic, isAwaitingSnapshot } from './state.js';
export type { SessionState } from './state.js';

export { formatGap, formatLapTime, toMilliseconds } from './time.js';

export { Cursor, Timeline } from './timeline.js';
export type { MessageSource, TimelineOptions, TopicChange, TopicListener, TopicsListener } from './timeline.js';

export { ID_KEYED_TOPICS, OBJECT_TOPICS, RACE_SESSION_KINDS, RecordType, SessionStatusCode } from './topics.js';
export type * from './topics.js';
