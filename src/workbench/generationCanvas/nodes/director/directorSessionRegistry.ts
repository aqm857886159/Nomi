import type { DirectorProject } from './model/directorTypes'
import type { DirectorStore } from './model/directorStore'
import type { DirectorShotFocus } from './model/directorShotFocus'

type Session = {
  store: DirectorStore
  defaultSceneName: string
  /** Persist the same export that the mounted editor now owns. */
  onExternalProjectChange?: (project: DirectorProject) => void
  /** 3D-BOX: which planned shots the user has selected right now (Agent send reads it; the composer tag subscribes). */
  shotFocus?: () => DirectorShotFocus | null
  /** Clear that selection (the tag's ×): the editor's selection is the one owner, so the tag never keeps its own copy. */
  clearShotFocus?: () => void
  /** Notify when the editor state behind shotFocus may have changed. */
  subscribe?: (listener: () => void) => () => void
}
const sessions = new Map<string, Session>()
const focusListeners = new Set<() => void>()
const notifyFocus = () => { for (const listener of [...focusListeners]) listener() }

export function registerDirectorSession(nodeId: string | undefined, session: Session): () => void {
  if (!nodeId) return () => undefined
  sessions.set(nodeId, session)
  const unsubscribe = session.subscribe?.(notifyFocus)
  notifyFocus()
  return () => {
    unsubscribe?.()
    if (sessions.get(nodeId) === session) sessions.delete(nodeId)
    notifyFocus()
  }
}

/** The single external write door reserved for stage_shot/AI in 3b. */
export function writeExternalDirectorProject(nodeId: string, project: DirectorProject): boolean {
  const session = sessions.get(nodeId)
  if (!session) return false
  session.store.getState().loadProject(project, session.defaultSceneName, { keepView: true })
  // External AI/stage writes must cross the node boundary immediately. Waiting for
  // the editor's idle save leaves a reload/close window where the old node meta wins.
  session.onExternalProjectChange?.(session.store.getState().exportProject())
  return true
}

/**
 * While the editor is open its store is the only writer (plan §3), so the hand edits an
 * AI patch must preserve are read here — node meta can lag up to the 2s idle save.
 */
export function readDirectorSessionProject(nodeId: string): DirectorProject | null {
  return sessions.get(nodeId)?.store.getState().exportProject() ?? null
}

export function hasDirectorSession(nodeId: string): boolean {
  return sessions.has(nodeId)
}

/** The 3D director editor is mounted somewhere right now (the Agent's director-only tools key off this). */
export function isAnyDirectorSessionOpen(): boolean {
  return sessions.size > 0
}

export function subscribeDirectorShotFocus(listener: () => void): () => void {
  focusListeners.add(listener)
  return () => { focusListeners.delete(listener) }
}

export function clearDirectorShotFocus(): void {
  for (const session of sessions.values()) session.clearShotFocus?.()
}

/** The mounted editor's shot focus (one editor is open at a time; the newest registration wins). */
export function readDirectorShotFocus(): DirectorShotFocus | null {
  for (const session of [...sessions.values()].reverse()) {
    const focus = session.shotFocus?.()
    if (focus) return focus
  }
  return null
}
