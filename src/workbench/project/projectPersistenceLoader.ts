import { importWithRetry } from '../../ui/chunkBoundary'

export type ProjectPersistenceModule = typeof import('./projectPersistenceService')

/**
 * The project library is intentionally kept light, so persistence/migration code is a dynamic
 * chunk. Keep its loader on the same retry boundary as all other lazy chunks: a transient asar or
 * filesystem read failure must not turn a project card click into a silent no-op.
 */
export function loadProjectPersistenceModule(): Promise<ProjectPersistenceModule> {
  return importWithRetry(() => import('./projectPersistenceService'))
}
