import { precedingLaneInput } from './laneOriginalInput.mjs';
import type { LaneBranchQuery, LaneEntry } from '../shared/agentLane/laneSnapshotTypes.js';
import type { LaneSession } from './laneSession.mjs';

export const LANE_HISTORY_PAGE_SIZE = 80;

/** Disposable UI page cache. Every row comes from the current pi branch; never used by the model. */
export async function openLaneHistoryPage(session: LaneSession, initialTip?: string | null) {
  let entries: LaneEntry[] = [];
  let hasMore = false;
  let previousInputId: string | undefined;
  let generation = 0;
  let loading: Promise<void> | undefined;
  const read = (tip: string | null, cursor?: number) => {
    if (tip === null) return { entries: [], hasMore: false, previousInputId: undefined };
    const query: LaneBranchQuery = {
      start: tip,
      order: 'newestFirst',
      limit: LANE_HISTORY_PAGE_SIZE + 1,
      ...(cursor === undefined ? {} : { cursor: { seq: cursor } }),
    };
    const page = session.findBranchEntries(query);
    const slice = page.slice(0, LANE_HISTORY_PAGE_SIZE).reverse();
    const previous = precedingLaneInput(session, slice[0]?.parentId ?? null);
    return { entries: slice, hasMore: page.length > LANE_HISTORY_PAGE_SIZE, previousInputId: previous?.id };
  };
  const reset = async (tip?: string | null) => {
    const epoch = ++generation;
    loading = undefined;
    const page = read(tip === undefined ? session.getTipId() : tip);
    if (epoch !== generation) return;
    entries = page.entries;
    hasMore = page.hasMore;
    previousInputId = page.previousInputId;
  };
  await reset(initialTip);
  return {
    entries: (): readonly LaneEntry[] => entries,
    previousInputId: () => previousInputId,
    state: () => ({ hasMore, ...(entries[0] ? { before: entries[0].id } : {}) }),
    reset,
    append: (entry: LaneEntry) => {
      if (entry.seq <= (entries.at(-1)?.seq ?? -1)) return;
      entries = [...entries, entry];
    },
    older: (before: string): Promise<void> => {
      if (!hasMore || before !== entries[0]?.id) return Promise.reject(new Error('agent_lane_workspace_stale'));
      if (loading) return loading;
      const epoch = generation;
      const cursor = entries[0].seq;
      const tipId = entries.at(-1)!.id;
      loading = Promise.resolve().then(() => {
        const page = read(tipId, cursor);
        if (epoch !== generation) return;
        entries = [...page.entries, ...entries];
        hasMore = page.hasMore;
        previousInputId = page.previousInputId;
      }).finally(() => { loading = undefined; });
      return loading;
    },
  };
}
