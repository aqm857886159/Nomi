import type { Entry, JsonValue } from '@earendil-works/pi-agent-core/harness/session';

/** Durable locations only: the original pi message remains the sole text authority. */
export const LANE_TRACE_REDACTIONS_NOTE = 'nomi.ui.trace-redactions';
type JsonPath = (string | number)[];
type Range = [number, number];
interface Redaction {
  entryId: string;
  path: JsonPath;
  /** UTF-16 offsets into the immutable original string, start inclusive / end exclusive. */
  ranges?: Range[];
  /** A secret used as an object key cannot safely appear in the location metadata. */
  omit?: true;
}
const MASK = '«redacted»';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const samePath = (left: JsonPath, right: JsonPath) => JSON.stringify(left) === JSON.stringify(right);
const coversPath = (parent: JsonPath, child: JsonPath) =>
  parent.length <= child.length && parent.every((segment, index) => segment === child[index]);

function mergeRanges(ranges: readonly Range[]): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function validRedaction(value: unknown): value is Redaction {
  if (!isRecord(value) || typeof value.entryId !== 'string' || !Array.isArray(value.path)
    || !['message', 'data'].includes(value.path[0])
    || !value.path.every(part => typeof part === 'string' || (typeof part === 'number' && Number.isSafeInteger(part) && part >= 0))) return false;
  return value.omit === true || (Array.isArray(value.ranges) && value.ranges.length > 0
    && value.ranges.every(range => Array.isArray(range) && range.length === 2
      && range.every(position => typeof position === 'number' && Number.isSafeInteger(position))
      && range[0] >= 0 && range[1] > range[0]));
}

function storedRedactions(entries: readonly Entry[]): Redaction[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const redactions: Redaction[] = [];
  for (const note of entries) {
    if (note.type !== 'custom' || note.customType !== LANE_TRACE_REDACTIONS_NOTE
      || !isRecord(note.data) || note.data.version !== 1 || !Array.isArray(note.data.redactions)) continue;
    for (const location of note.data.redactions) {
      if (!validRedaction(location)) continue;
      const target = byId.get(location.entryId);
      // A note covers only already-persisted source entries, never future messages or another note.
      if (!target || target.seq >= note.seq
        || (target.type === 'custom' && target.customType === LANE_TRACE_REDACTIONS_NOTE)) continue;
      redactions.push(location);
    }
  }
  return redactions;
}

/** null means no new locations: callers must not append an empty/redundant custom entry. */
export function collectTraceRedactions(entries: readonly Entry[], secrets: readonly string[]): JsonValue {
  const needles = [...new Set(secrets.filter(secret => secret.length > 0))];
  if (!needles.length) return null;
  const stored = storedRedactions(entries);
  const additions: Redaction[] = [];
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === LANE_TRACE_REDACTIONS_NOTE) continue;
    const prior = stored.filter(location => location.entryId === entry.id);
    const visit = (value: unknown, path: JsonPath): void => {
      if (prior.some(location => location.omit && coversPath(location.path, path))) return;
      if (typeof value === 'string') {
        const found: Range[] = [];
        for (const secret of needles) {
          let offset = value.indexOf(secret);
          while (offset !== -1) {
            found.push([offset, offset + secret.length]);
            offset = value.indexOf(secret, offset + 1);
          }
        }
        if (!found.length) return;
        const existing = mergeRanges(prior.filter(location => samePath(location.path, path)).flatMap(location => location.ranges ?? []));
        const ranges = mergeRanges([...existing, ...found]);
        if (JSON.stringify(ranges) !== JSON.stringify(existing)) additions.push({ entryId: entry.id, path, ranges });
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, [...path, index]));
      } else if (isRecord(value)) {
        if (Object.keys(value).some(key => needles.some(secret => key.includes(secret)))) {
          additions.push({ entryId: entry.id, path, omit: true });
          return;
        }
        for (const [key, item] of Object.entries(value)) visit(item, [...path, key]);
      }
    };
    if (entry.type === 'message') visit(entry.message, ['message']);
    else if ('data' in entry) visit(entry.data, ['data']);
    // Entry ids, parent ids and timestamps are pi-owned linkage, never redaction targets.
  }
  return additions.length ? { version: 1, redactions: additions } as unknown as JsonValue : null;
}

function ownValue(root: unknown, path: JsonPath): unknown {
  let value = root;
  for (const segment of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined;
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}

/** Apply every note to an independent snapshot, combining ranges before changing string lengths. */
export function applyTraceRedactions(entries: readonly Entry[]): Entry[] {
  const stored = storedRedactions(entries);
  return entries.map(entry => {
    const locations = stored.filter(location => location.entryId === entry.id);
    if (!locations.length) return entry;
    const copy = structuredClone(entry);
    const groups = new Map<string, Redaction[]>();
    for (const location of locations) {
      const key = JSON.stringify(location.path);
      groups.set(key, [...(groups.get(key) ?? []), location]);
    }
    // Containers are omitted before their descendants; descendant writes then have no target.
    const ordered = [...groups.values()].sort((a, b) => a[0].path.length - b[0].path.length);
    for (const group of ordered) {
      const path = group[0].path;
      const parent = ownValue(copy, path.slice(0, -1));
      const leaf = path.at(-1)!;
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, leaf)) continue;
      const value = ownValue(copy, path);
      let replacement: unknown;
      if (group.some(location => location.omit)) replacement = MASK;
      else {
        if (typeof value !== 'string') continue;
        const ranges = mergeRanges(group.flatMap(location => location.ranges ?? [])).filter(([, end]) => end <= value.length);
        let cursor = 0;
        let text = '';
        for (const [start, end] of ranges) { text += value.slice(cursor, start) + MASK; cursor = end; }
        replacement = text + value.slice(cursor);
      }
      Object.defineProperty(parent, leaf, { value: replacement, writable: true, enumerable: true, configurable: true });
    }
    return copy;
  });
}
