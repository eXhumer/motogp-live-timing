import { isFullSnapshot, isRefresh, isSnapshotSized, REFRESH_KEY, type TimingMessage } from './decode.js';
import { applyRows } from './merge.js';
import type { Topic, TopicState } from './topics.js';

/**
 * Merged state of every topic at one instant. Immutable: applying a message
 * returns a new object, and topics the message does not touch keep their
 * identity.
 */
export type SessionState = Readonly<Record<string, unknown>>;

export const EMPTY_STATE: SessionState = Object.freeze({});

/** Set (as a symbol, so it is not a topic) between a `refresh` and the next full snapshot. */
const AWAITING_SNAPSHOT = Symbol('awaitingSnapshot');

/** Whether the state is waiting for a full snapshot after a `refresh`; deltas are ignored meanwhile. */
export function isAwaitingSnapshot(state: SessionState): boolean {
  return (state as Readonly<Record<symbol, unknown>>)[AWAITING_SNAPSHOT] === true;
}

/**
 * Apply one message to a session state and return the new state.
 *
 * A full snapshot replaces the state (and, as in the web app, drops
 * `flashMessage`). A `refresh` without a snapshot keeps the state but ignores
 * deltas until the next snapshot-sized message.
 */
export function applyMessage(state: SessionState, message: TimingMessage): SessionState {
  const { data } = message;
  if (isFullSnapshot(data) || (isAwaitingSnapshot(state) && isSnapshotSized(data))) {
    const { flashMessage: _flash, ...next } = applyTopics(EMPTY_STATE, data);
    return next;
  }
  if (isRefresh(data)) return { ...state, [AWAITING_SNAPSHOT]: true };
  if (isAwaitingSnapshot(state)) return state;
  return applyTopics(state, data);
}

function applyTopics(state: SessionState, data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...state };
  for (const [topic, rows] of Object.entries(data)) {
    if (topic !== REFRESH_KEY) next[topic] = applyRows(topic, next[topic], rows);
  }
  return next;
}

/** Typed read of one topic from a session state. */
export function getTopic<T extends Topic>(state: SessionState, topic: T): TopicState<T> | undefined {
  return state[topic] as TopicState<T> | undefined;
}
