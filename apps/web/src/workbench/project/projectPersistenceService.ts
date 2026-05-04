import {
  importServerWorkbenchProject,
  saveServerWorkbenchProject,
} from './serverWorkbenchProjectRepository'
import { readLocalProject, saveLocalProject, type LocalProjectSummary } from '../library/localProjectStore'
import { upgradeWorkbenchProjectMediaUrls } from './projectMediaMigration'
import { restoreWorkbenchProjectPayload, subscribeWorkbenchProjectPersistence } from './workbenchProjectSession'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'

const SERVER_PROJECT_MAP_KEY = 'nomi-workbench-server-project-map-v1'
const LAST_ACTIVE_PROJECT_KEY = 'nomi-workbench-last-active-project-v1'

type ServerProjectMap = Record<string, string>

type ServerSyncTask = {
  localProjectId: string
  serverProjectId: string | null
  payload: WorkbenchProjectPayload
  projectName: string
  localRevision: number
}

type Dependencies = {
  refreshProjects: () => void
  setActiveProject: (project: LocalProjectSummary | null) => void
  setView: (view: 'library' | 'studio') => void
  onSaveError: (error: unknown) => void
}

function readServerProjectMap(): ServerProjectMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = JSON.parse(window.localStorage.getItem(SERVER_PROJECT_MAP_KEY) || '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

function readMappedServerProjectId(localProjectId: string): string | null {
  return readServerProjectMap()[localProjectId] || null
}

function writeMappedServerProjectId(localProjectId: string, serverProjectId: string): void {
  if (typeof window === 'undefined') return
  const map = readServerProjectMap()
  window.localStorage.setItem(SERVER_PROJECT_MAP_KEY, JSON.stringify({
    ...map,
    [localProjectId]: serverProjectId,
  }))
}

function readWindowSearchParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = new URL(window.location.href).searchParams.get(name)
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function readLastActiveProjectId(): string | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(LAST_ACTIVE_PROJECT_KEY)
  return value && value.trim() ? value.trim() : null
}

function writeLastActiveProjectId(projectId: string): void {
  if (typeof window === 'undefined') return
  const id = projectId.trim()
  if (!id) return
  window.localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id)
}

export type WorkbenchProjectPersistenceService = {
  hydrateProject: (projectId: string) => Promise<WorkbenchProjectRecordV1 | null>
  hydrateInitialProject: (projects: readonly LocalProjectSummary[]) => Promise<WorkbenchProjectRecordV1 | null>
  persistProject: (project: LocalProjectSummary, payload: WorkbenchProjectPayload) => Promise<WorkbenchProjectRecordV1>
  getMappedServerProjectId: (localProjectId: string) => string | null
  bindProjectPersistence: (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }) => () => void
}

export function createWorkbenchProjectPersistenceService(deps: Dependencies): WorkbenchProjectPersistenceService {
  const serverSyncState = {
    running: false,
    pending: null as ServerSyncTask | null,
    latestAppliedRevisionByProject: {} as Record<string, number>,
  }

  const queueServerProjectSync = (input: ServerSyncTask): void => {
    serverSyncState.pending = input
    const drain = async () => {
      if (serverSyncState.running) return
      serverSyncState.running = true
      try {
        while (serverSyncState.pending) {
          const next = serverSyncState.pending
          serverSyncState.pending = null
          try {
            const serverProject = next.serverProjectId
              ? await saveServerWorkbenchProject(next.serverProjectId, next.payload, next.projectName)
              : await importServerWorkbenchProject(next.payload, next.projectName)
            const currentApplied = serverSyncState.latestAppliedRevisionByProject[next.localProjectId] ?? -1
            if (next.localRevision >= currentApplied) {
              serverSyncState.latestAppliedRevisionByProject[next.localProjectId] = next.localRevision
              writeMappedServerProjectId(next.localProjectId, serverProject.id)
            }
          } catch (error: unknown) {
            deps.onSaveError(error)
          }
        }
      } finally {
        serverSyncState.running = false
        if (serverSyncState.pending) void drain()
      }
    }
    void drain()
  }

  const persistProject = async (project: LocalProjectSummary, payload: WorkbenchProjectPayload): Promise<WorkbenchProjectRecordV1> => {
    const localSaved = saveLocalProject(project.id, payload, project.name)
    writeLastActiveProjectId(localSaved.id)
    queueServerProjectSync({
      localProjectId: project.id,
      serverProjectId: readMappedServerProjectId(project.id),
      payload,
      projectName: project.name,
      localRevision: localSaved.revision ?? 0,
    })
    deps.setActiveProject(localSaved)
    deps.refreshProjects()
    return localSaved
  }

  const bindProjectPersistence = (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }): (() => void) => {
    return subscribeWorkbenchProjectPersistence({
      projectId: input.project.id,
      projectName: input.project.name,
      isHydrating: input.isHydrating,
      canPersist: input.canPersist,
      saveProject: async (_projectId, payload, _projectName) => persistProject(input.project, payload),
      onSaved: input.onSaved,
      onSaveError: input.onSaveError,
    })
  }

  const hydrateProject = async (projectId: string): Promise<WorkbenchProjectRecordV1 | null> => {
    const project = readLocalProject(projectId)
    if (!project) return null
    const upgraded = await upgradeWorkbenchProjectMediaUrls(project)
    if (upgraded !== project) {
      saveLocalProject(upgraded.id, upgraded.payload, upgraded.name)
      deps.refreshProjects()
    }
    restoreWorkbenchProjectPayload(upgraded.payload)
    writeLastActiveProjectId(upgraded.id)
    deps.setActiveProject(upgraded)
    deps.setView('studio')
    queueServerProjectSync({
      localProjectId: upgraded.id,
      serverProjectId: readMappedServerProjectId(upgraded.id),
      payload: upgraded.payload,
      projectName: upgraded.name,
      localRevision: upgraded.revision ?? 0,
    })
    return upgraded
  }

  const hydrateInitialProject = async (projects: readonly LocalProjectSummary[]): Promise<WorkbenchProjectRecordV1 | null> => {
    const explicitProjectId = readWindowSearchParam('projectId')
    if (explicitProjectId) {
      const explicitProject = await hydrateProject(explicitProjectId)
      if (explicitProject) return explicitProject
    }

    const lastActiveProjectId = readLastActiveProjectId()
    if (lastActiveProjectId) {
      const lastActiveProject = await hydrateProject(lastActiveProjectId)
      if (lastActiveProject) return lastActiveProject
    }

    const latestProjectId = projects[0]?.id
    return latestProjectId ? hydrateProject(latestProjectId) : null
  }

  return {
    hydrateProject,
    hydrateInitialProject,
    persistProject,
    getMappedServerProjectId: readMappedServerProjectId,
    bindProjectPersistence,
  }
}
