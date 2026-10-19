/**
 * MotoGP live timing merge rules, ported from the timingpass web app's
 * `snapshot` store. Every topic update is one row or an array of rows, and
 * each row is merged on its own:
 *
 * - single-value topics ({@link OBJECT_TOPICS}) are replaced by the row;
 * - `lap` and `penalty` keep a list per racer (`rid`), matched by lap (`nl`);
 * - `sector` is keyed by racer, then lap (`ln`), with sector `sn` at index `sn - 1`;
 * - `runLap` and `runSummary` nest by racer, run (`rn`) and lap;
 * - `marshallingSectorState` keeps the newest row (by `sca`) per track sector and post;
 * - `record` rows are matched by type (`tp`), {@link ID_KEYED_TOPICS} by `id`,
 *   every other topic by racer (`rid`).
 *
 * Where the web app has an obvious bug (`runSummary` writes to the wrong key,
 * `marshallingSectorState` never finds the previous row) this port follows
 * the intent instead.
 *
 * The merge never mutates its inputs. Branches a row does not touch keep
 * their identity, so consumers can compare references to find what changed.
 */
import { isPlainObject } from './decode.js';
import { ID_KEYED_TOPICS, OBJECT_TOPICS } from './topics.js';

type Row = Record<string, unknown>;
type Tree = Readonly<Record<string, unknown>>;

const OBJECT_TOPIC_SET: ReadonlySet<string> = new Set(OBJECT_TOPICS);
const ID_KEYED_TOPIC_SET: ReadonlySet<string> = new Set(ID_KEYED_TOPICS);

/** Merge one topic update (a row or an array of rows) into the topic's state. */
export function applyRows(topic: string, state: unknown, rows: unknown): unknown {
  let next = state;
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    if (isPlainObject(row)) next = applyRow(topic, next, row);
  }
  return next;
}

/** The key a list topic matches rows by. */
export function rowKey(topic: string): string {
  if (topic === 'record') return 'tp';
  return ID_KEYED_TOPIC_SET.has(topic) ? 'id' : 'rid';
}

function applyRow(topic: string, state: unknown, row: Row): unknown {
  if (OBJECT_TOPIC_SET.has(topic)) return row;
  switch (topic) {
    case 'lap':
    case 'penalty':
      return eachRiderRow(row, state, (tree, r) => upsertRiderList(tree, r));
    case 'sector':
      return applySector(state, row);
    case 'runLap':
      return applyRunLap(state, row);
    case 'runSummary':
      return applyRunSummary(state, row);
    case 'marshallingSectorState':
      return applyMarshalling(state, row);
    default:
      return upsert(Array.isArray(state) ? state : [], row, rowKey(topic));
  }
}

/** Replace the row with the same `key` value, or append it. */
function upsert(list: readonly unknown[], row: Row, key: string): unknown[] {
  const out = list.slice();
  const index = out.findIndex((item) => isPlainObject(item) && item[key] === row[key]);
  if (index === -1) out.push(row);
  else out[index] = row;
  return out;
}

/** A row with `rid` is applied as is; otherwise each of its values is a row. */
function eachRiderRow(row: Row, state: unknown, apply: (tree: Tree, row: Row) => Tree): Tree {
  if (Object.hasOwn(row, 'rid')) return apply(asTree(state), row);
  let tree = asTree(state);
  for (const value of Object.values(row)) if (isPlainObject(value)) tree = apply(tree, value);
  return tree;
}

function upsertRiderList(tree: Tree, row: Row): Tree {
  const rid = String(row['rid']);
  const list = tree[rid];
  return { ...tree, [rid]: upsert(Array.isArray(list) ? list : [], row, 'nl') };
}

function applySector(state: unknown, row: Row): Tree {
  const tree = asTree(state);
  if (!Object.hasOwn(row, 'rid')) return { ...tree, ...row };
  const sn = Number(row['sn']);
  if (!Number.isInteger(sn) || sn < 1) return tree;
  const path = [String(row['rid']), String(row['ln'])];
  const existing = getIn(tree, path);
  const list = Array.isArray(existing) ? existing.slice() : [];
  list[sn - 1] = row;
  return setIn(tree, path, list);
}

function applyRunLap(state: unknown, row: Row): Tree {
  let tree = asTree(state);
  if (Object.hasOwn(row, 'rid')) return setIn(tree, [String(row['rid']), String(row['rn']), String(row['nl'])], row);
  for (const level of Object.values(row)) {
    for (const laps of Object.values(asTree(level))) {
      if (!Array.isArray(laps)) continue;
      for (const lap of laps) {
        if (isPlainObject(lap)) tree = setIn(tree, [String(lap['rid']), String(lap['rn']), String(lap['nl'])], lap);
      }
    }
  }
  return tree;
}

function applyRunSummary(state: unknown, row: Row): Tree {
  let tree = asTree(state);
  if (Object.hasOwn(row, 'rid')) return setIn(tree, [String(row['rid']), String(row['rn'])], row);
  for (const level of Object.values(row)) {
    for (const [run, summary] of Object.entries(asTree(level))) {
      if (isPlainObject(summary)) tree = setIn(tree, [String(summary['rid']), run], summary);
    }
  }
  return tree;
}

function applyMarshalling(state: unknown, row: Row): Tree {
  let tree = asTree(state);
  const sectors = row['atns'];
  if (!Array.isArray(sectors)) return tree;
  const changed = Date.parse(String(row['sca']));
  for (const sector of sectors) {
    const path = [String(sector), String(row['num'])];
    const previous = getIn(tree, path);
    if (isPlainObject(previous) && Date.parse(String(previous['sca'])) > changed) continue;
    tree = setIn(tree, path, row);
  }
  return tree;
}

function asTree(value: unknown): Tree {
  return isPlainObject(value) ? value : {};
}

function getIn(tree: Tree, path: readonly string[]): unknown {
  let node: unknown = tree;
  for (const key of path) node = asTree(node)[key];
  return node;
}

function setIn(tree: Tree, path: readonly string[], value: unknown): Tree {
  const [head, ...rest] = path as [string, ...string[]];
  return { ...tree, [head]: rest.length === 0 ? value : setIn(asTree(tree[head]), rest, value) };
}
