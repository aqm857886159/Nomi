import { readLocalProjectAsync, renameLocalProject, saveLocalProject, type LocalProjectSummary } from '../library/localProjectStore'
import { backfillCanvasMediaDimensions, upgradeWorkbenchProjectMediaUrls, normalizeLegacyImageAssetKinds } from './projectMediaMigration'
import {
  clearActiveWorkbenchProjectSaveTarget,
  replayCanvasEventTailAndSealGenesis,
  restoreWorkbenchProjectPayload,
  subscribeWorkbenchProjectPersistence,
  type WorkbenchProjectSaveBaseline,
} from './workbenchProjectSession'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1 } from './projectRecordSchema'
import { retireStoryboardTableViews } from './storyboardTableRetirement'
import { migrateProjectRecord, type CategoryMigrationDiagnostic } from './projectCategoryMigration'
import { migrateProjectV51ToV60 } from './projectV51ToV60Migration'
import { backfillShotIndexes } from '../generationCanvas/model/shotNumbering'
import { backfillNodeResultVersionNumbers } from '../generationCanvas/model/nodeResultLifecycle'
import { useShotVerifyStore } from '../generationCanvas/agent/shotVerifyStore'
import type { ProjectHydrationGuard } from './projectCanvasReadSurface'
import { invalidateAgentTurnStates } from '../ai/agentTurnLifecycle'
import { measureProjectOpenStage, measureProjectOpenStageSync } from './projectOpenTimeline'
import { sweepPersistedAssetDeletions } from '../assets/pendingAssetDeletions'
import { logRendererError } from '../../desktop/rendererLog'
import { announceQuarantine } from './projectQuarantineAnnounce'
import { useWorkbenchStore } from '../workbenchStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'

function isGuardCurrent(guard: ProjectHydrationGuard): boolean {
  try {
    guard.assertCurrent()
    return true
  } catch {
    return false
  }
}

const categoryMigrationDiagnostics = new WeakMap<object, CategoryMigrationDiagnostic>()
/** 这次打开移除了几张已退役的分镜表节点（要给用户一句可见提示）。 */
const retiredTableCounts = new WeakMap<object, number>()

function abandonHydratingProjectOwnership(): void {
  invalidateAgentTurnStates()
  // Hydration replaces the whole project snapshot. Invalidate review work here,
  // not when the persistence subscription merely rebinds after an ordinary save.
  useShotVerifyStore.getState().activateProject(null)
}

/** 这次打开移除了几张分镜表节点；取走即清（只认这一轮 hydration 的 guard）。 */
export function consumeRetiredStoryboardTableCount(guard: ProjectHydrationGuard): number {
  const value = retiredTableCounts.get(guard) ?? 0
  retiredTableCounts.delete(guard)
  return value
}

/** Returns + clears only the diagnostic owned by this exact hydration epoch. */
export function consumeCategoryMigrationDiagnostic(guard: ProjectHydrationGuard): CategoryMigrationDiagnostic | null {
  const value = categoryMigrationDiagnostics.get(guard) ?? null
  categoryMigrationDiagnostics.delete(guard)
  return value
}

const LAST_ACTIVE_PROJECT_KEY = 'nomi-workbench-last-active-project-v1'

type Dependencies = {
  setActiveProject: (project: LocalProjectSummary | null) => void
  isActiveProject: (projectId: string) => boolean
}


function writeLastActiveProjectId(projectId: string): void {
  if (typeof window === 'undefined') return
  const id = projectId.trim()
  if (!id) return
  window.localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id)
}

export type WorkbenchProjectPersistenceService = {
  hydrateProject: (projectId: string, guard: ProjectHydrationGuard) => Promise<WorkbenchProjectRecordV1 | null>
  /** 改名 + 把当前内存内容落盘。项目名只在这里（和项目库改名）写；自动保存绝不写名字。 */
  renameProjectAndPersist: (project: LocalProjectSummary, payload: WorkbenchProjectPayload) => Promise<WorkbenchProjectRecordV1>
  bindProjectPersistence: (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }) => () => Promise<void>
}

export function createWorkbenchProjectPersistenceService(deps: Dependencies): WorkbenchProjectPersistenceService {
  let baseline: WorkbenchProjectSaveBaseline | undefined

  const renameProjectAndPersist = async (project: LocalProjectSummary, payload: WorkbenchProjectPayload): Promise<WorkbenchProjectRecordV1> => {
    const owner = baseline
    await renameLocalProject(project.id, project.name)
    const localSaved = await saveLocalProject(project.id, payload)
    if (owner?.savedRecord.id === localSaved.id) owner.savedRecord = localSaved
    if (deps.isActiveProject(localSaved.id)) {
      writeLastActiveProjectId(localSaved.id)
      deps.setActiveProject(localSaved)
    }
    return localSaved
  }

  const bindProjectPersistence = (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }): (() => Promise<void>) => {
    const opened = baseline?.savedRecord.id === input.project.id ? baseline : undefined
    return subscribeWorkbenchProjectPersistence({
      projectId: input.project.id,
      baseline: opened,
      isHydrating: input.isHydrating,
      canPersist: () => (!opened || baseline === opened) && input.canPersist(),
      saveProject: async (_projectId, payload) => {
        // 只写内容。名字不是自动保存的字段：input.project 是「打开那一刻」的快照，名字可能早被别的路径改过。
        const localSaved = await saveLocalProject(input.project.id, payload)
        if (input.canPersist()) writeLastActiveProjectId(localSaved.id)
        return localSaved
      },
      onSaved: (record) => {
        input.onSaved(record)
        announceQuarantine(record.id) // 这次保存另存了被隔离的项 → 提醒一次
      },
      onSaveError: input.onSaveError,
    })
  }

  const hydrateProject = async (
    projectId: string,
    guard: ProjectHydrationGuard,
  ): Promise<WorkbenchProjectRecordV1 | null> => {
    baseline = undefined
    abandonHydratingProjectOwnership()
    clearActiveWorkbenchProjectSaveTarget()
    guard.assertCurrent()
    const project = await measureProjectOpenStage('read-project', () => readLocalProjectAsync(projectId))
    guard.assertCurrent()
    if (!project) return null
    const { diagnostic, mediaDimensionsUpgraded, retiredTables } = await measureProjectOpenStage('migrate', async () => {
      const mediaUpgraded = await upgradeWorkbenchProjectMediaUrls(project)
      guard.assertCurrent()
      const { record: catUpgraded, diagnostic } = migrateProjectRecord(mediaUpgraded)
      const { record: v60Upgraded0 } = migrateProjectV51ToV60(catUpgraded)
      const { record: v60Upgraded, retired: retiredTables } = retireStoryboardTableViews(v60Upgraded0)
      // A1.5：历史导入/切图/裁剪/截图的 image 节点改判为 asset（素材卡）。
      const assetUpgraded = normalizeLegacyImageAssetKinds(v60Upgraded)
      const mediaDimensionsUpgraded = await backfillCanvasMediaDimensions(assetUpgraded)
      return { diagnostic, mediaDimensionsUpgraded, retiredTables }
    })
    // 镜头编号存储身份化（审计 A2）：存量项目缺 shotIndex 的镜头节点按
    // (y, x, id) 确定性回填一次；此后编号不再随布局/添加节点漂移。
    const shotBackfill = backfillShotIndexes(mediaDimensionsUpgraded.payload.generationCanvas.nodes)
    // 「第 N 版」同理：旧项目的版本没有号，按持久顺序（最早 = 1）在内存补齐，之后号跟着版本走。
    const versionBackfill = backfillNodeResultVersionNumbers(shotBackfill.nodes)
    const upgraded = shotBackfill.changed || versionBackfill.changed
      ? {
          ...mediaDimensionsUpgraded,
          payload: {
            ...mediaDimensionsUpgraded.payload,
            generationCanvas: {
              ...mediaDimensionsUpgraded.payload.generationCanvas,
              nodes: versionBackfill.nodes,
            },
          },
        }
      : mediaDimensionsUpgraded
    if (!diagnostic.alreadyMigrated && (diagnostic.migratedNodes > 0 || diagnostic.removedNodes > 0 || diagnostic.categoriesSeeded)) {
      categoryMigrationDiagnostics.set(guard, diagnostic)
    }
    if (retiredTables > 0) retiredTableCounts.set(guard, retiredTables)
    // A turn begun while the read was pending still targets the outgoing project.
    abandonHydratingProjectOwnership()
    guard.assertCurrent()
    measureProjectOpenStageSync('restore-store', () => restoreWorkbenchProjectPayload(upgraded.payload, upgraded.id))
    // S5-b-1:重放快照没盖到的事件尾巴(崩溃恢复),保留含尾后态作为首笔画布编辑的基线。
    await measureProjectOpenStage('replay-events', () => replayCanvasEventTailAndSealGenesis(upgraded.id, upgraded.payload, guard))
    guard.assertCurrent()
    baseline = {
      savedRecord: project,
      workbenchRevision: useWorkbenchStore.getState().persistRevision,
      canvasRevision: useGenerationCanvasStore.getState().persistRevision,
    }
    // Event-tail replay crosses IPC and the restored canvas is already visible. A turn may
    // start in that window with the outgoing project's identity; close the hydration epoch
    // once more before publishing the new active project.
    abandonHydratingProjectOwnership()
    writeLastActiveProjectId(upgraded.id)
    guard.assertCurrent()
    // 上次删掉的版本、App 直接退出没来得及删的文件：现在撤销日志是空的，没有哪一步能退回去了。
    // 不挡打开（清扫在后台走），判定读的是刚载入、含事件尾巴的整份项目内容（读不全就全部保留）。
    if (upgraded.payload.pendingAssetDeletions?.length) {
      void sweepPersistedAssetDeletions(upgraded.id, upgraded.payload.pendingAssetDeletions, () => {
        // 还是这个项目开着才存（清扫期间换了项目就不碰下一个项目的盘；那一笔下次打开再扫）。
        if (isGuardCurrent(guard)) useGenerationCanvasStore.getState().commitPersistedChange()
      })
        .catch((error: unknown) => logRendererError('pending-asset-deletion-sweep-failed', error))
    }
    announceQuarantine(upgraded.id) // 打开时有项被隔离（读盘逐项判出来的）→ 提醒一次
    return upgraded
  }

  return {
    hydrateProject,
    renameProjectAndPersist,
    bindProjectPersistence,
  }
}
