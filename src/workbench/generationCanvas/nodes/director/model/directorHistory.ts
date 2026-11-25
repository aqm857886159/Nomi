import { createStore, type StoreApi } from 'zustand/vanilla'
import { temporal, type TemporalState } from 'zundo'
import type { HistoryDirection } from '../../../../history/historyMiddleware'
import { replaceEqualDeep } from '../../../../ai/v4/shareEqualDeep'
import type { DirectorStoreState, StoreGet, StoreSet } from './directorStore'
import type { DirectorProject } from './directorTypes'

export const HISTORY_LIMIT = 50
const WHEEL_MERGE_MS = 200
/** 连续手势里「不是自带撤销写口写的」那一笔的记号：它一出现，手势就不再接受并入。 */
const FOREIGN_WRITE = '\u0000foreign'

type ProjectFrame = Pick<DirectorStoreState, 'project'>
export type DirectorStore = StoreApi<DirectorStoreState> & { temporal: StoreApi<TemporalState<ProjectFrame>> }
type Commands = Pick<DirectorStoreState, 'saveState' | 'saveStateForWheel' | 'withHistory' | 'undo' | 'redo'>
type DirectorHistory = { commands: Commands; step(key: string, edit: () => void): void; clear(): void }

export function createDirectorHistoryStore(
  now: () => number,
  projectView: (state: DirectorStoreState, project: DirectorProject) => Partial<DirectorStoreState>,
  editor: (set: StoreSet, get: StoreGet, history: DirectorHistory) => DirectorStoreState,
): DirectorStore {
  type RecordFrame = (before: ProjectFrame, replace: undefined, after: ProjectFrame) => void
  type Transaction = { record?: RecordFrame; restoreJournal?: () => void }
  let transaction: Transaction | undefined
  let gesture: { key: string | null; pending: boolean; wheel?: { at: number; field?: string } } | undefined
  let writingKey: string | null = null

  function recordChange(record: RecordFrame, before: DirectorProject, after: DirectorProject) {
    // Ignore net-zero edits, including new objects with unchanged coordinates.
    if (replaceEqualDeep(before, after) === before) return false
    const journal = store.temporal.getState()
    const top = journal.pastStates.at(-1)?.project
    // An untracked spatial write may have already returned to the last checkpoint.
    if (top && replaceEqualDeep(top, before) === top) {
      if (journal.futureStates.length) store.temporal.setState({ futureStates: [] })
    } else {
      record({ project: before }, undefined, { project: after })
    }
    return true
  }

  const initialize = temporal<DirectorStoreState, [], [], ProjectFrame>((set, get) => {
    // Ordinary edits leave zundo untouched until commit. Travel and reload can
    // mutate its arrays immediately, so checkpoint only when composed with them.
    const checkpointJournal = () => {
      if (!transaction || transaction.restoreJournal) return
      const { pastStates, futureStates } = store.temporal.getState()
      const saved = { pastStates: [...pastStates], futureStates: [...futureStates] }
      transaction.restoreJournal = () => store.temporal.setState(saved)
    }
    const travel = (direction: HistoryDirection) => {
      gesture = undefined
      checkpointJournal()
      store.temporal.getState()[direction]()
    }

    const commands: Commands = {
      saveState: (wheelField) => {
        if (wheelField !== undefined) return get().saveStateForWheel(wheelField)
        if (!transaction) {
          gesture = { key: null, pending: true }
        }
      },
      saveStateForWheel: (field) => {
        if (transaction) return
        const at = now()
        if (!gesture?.wheel || at - gesture.wheel.at >= WHEEL_MERGE_MS || gesture.wheel.field !== field) {
          gesture = { key: null, pending: true }
        }
        gesture.wheel = { at, field }
      },
      withHistory: <T,>(action: () => T): T => {
        if (transaction) return action()
        const before = get()
        const previousGesture = gesture
        const batch: Transaction = {}
        transaction = batch
        try {
          const result = action()
          if (batch.record && recordChange(batch.record, before.project, get().project)) gesture = undefined
          return result
        } catch (error) {
          set(before)
          batch.restoreJournal?.()
          gesture = previousGesture
          throw error
        } finally {
          transaction = undefined
        }
      },
      undo: () => travel('undo'),
      redo: () => travel('redo'),
    }

    return editor(set, get, {
      commands,
      clear() {
        gesture = undefined
        checkpointJournal()
        store.temporal.getState().clear()
      },
      step(key, edit) {
        const continuing = transaction || (gesture && (gesture.key === null || gesture.key === key))
        writingKey = key
        try {
          if (continuing) edit()
          else commands.withHistory(edit)
        } finally {
          writingKey = null
        }
      },
    })
  }, {
    limit: HISTORY_LIMIT,
    partialize: ({ project }) => ({ project }),
    equality: (before, after) => before.project === after.project,
    handleSet: (record) => (before, _replace, after) => {
      // Defer zundo's recorder until the outer transaction succeeds. For a
      // continuous gesture, only the first effective write owns a checkpoint.
      if (transaction) {
        transaction.record = record
      } else if (gesture?.pending && typeof before === 'object' && before.project) {
        if (recordChange(record, before.project, after.project)) {
          gesture.pending = false
          gesture.key = writingKey ?? FOREIGN_WRITE
        }
      } else if (gesture && gesture.key !== writingKey) {
        gesture.key = FOREIGN_WRITE
      }
    },
  })

  // zundo restores a project-only frame via Zustand's setter. Reconcile its
  // scene and transient view in that same notification for renderer subscribers.
  const initializeWithView: typeof initialize = (set, get, api) => initialize((patch, replace) => {
    if (typeof patch === 'object' && patch.project) {
      set({ ...projectView(get(), patch.project), evaluatedPoses: {}, ...patch }, replace)
    } else {
      set(patch, replace)
    }
  }, get, api)
  const store: DirectorStore = createStore(initializeWithView)
  return store
}
