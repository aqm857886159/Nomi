import { trashProjectFiles } from './assetFileDeletion'
import { logRendererError } from '../../desktop/rendererLog'
import { readLocalProjectAsync, saveLocalProject } from '../library/localProjectStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'
import { applyAssetResultDeletion, countRemovedResults, planAssetDeletion, type ProjectFileTarget, type AssetDeletionRequest } from './assetResultDeletion'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { NodeResultLifecyclePatch } from '../generationCanvas/model/nodeResultLifecycle'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import {
  dropUndoBarriersAfter,
  getLatestUndoBarrierAbsolutePosition,
  getUndoJournalGeneration,
  getUndoJournalPosition,
  pushUndoSnapshot,
} from '../generationCanvas/events/canvasUndoJournal'
import { deferAssetFileDeletion, forgetDeferredAssetDeletion } from './pendingAssetDeletions'

export type DeleteAssetResultOutcome = {
  /** 从画布卡上摘掉的结果数（卡本身保留）。 */
  removedResultCount: number
  /** 当场进了系统回收站的文件数。 */
  deletedFileCount: number
  /** 进回收站失败的文件数（被占用、没权限、没有桌面桥）。 */
  failedFileCount: number
  /** 文件没当场删、等撤销窗口过去再删（已加载项目里摘了结果的删除都是这样）。 */
  deferredFileCount: number
  /** 这张素材的文件还被时间轴 / 白板 / 别的结果（含封面）用着，留着没删。 */
  keptInUseCount: number
}

const deletionQueues = new Map<string, Promise<void>>()

function serializeProjectDeletion<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const previous = deletionQueues.get(projectId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(operation)
  const tail = result.then(() => undefined, () => undefined)
  deletionQueues.set(projectId, tail)
  void tail.finally(() => {
    if (deletionQueues.get(projectId) === tail) deletionQueues.delete(projectId)
  })
  return result
}

function lifecycleFingerprint(value: Pick<GenerationCanvasNode, 'result' | 'history' | 'status' | 'error'>): string {
  return JSON.stringify({
    result: value.result,
    history: value.history ?? [],
    status: value.status,
    error: value.error,
  })
}

function rollbackAppliedPatches(
  rollbacks: Array<{ nodeId: string; before: NodeResultLifecyclePatch; applied: NodeResultLifecyclePatch }>,
): void {
  const store = useGenerationCanvasStore.getState()
  for (const rollback of rollbacks) {
    const current = store.nodes.find((node) => node.id === rollback.nodeId)
    if (!current || lifecycleFingerprint(current) !== lifecycleFingerprint(rollback.applied)) continue
    store.updateNode(rollback.nodeId, rollback.before)
  }
}

/** 文件当场进系统回收站（没有撤销步可挂的删除：关闭的项目，或画布上本来就没有要摘的结果）。 */
async function trashProjectFile(target: ProjectFileTarget): Promise<Pick<DeleteAssetResultOutcome, 'deletedFileCount' | 'failedFileCount'>> {
  try {
    const result = await trashProjectFiles(target.projectId, [target.relativePath])
    return { deletedFileCount: result.deletedCount, failedFileCount: result.failedCount }
  } catch (error) {
    logRendererError('asset-file-trash-failed', error)
    return { deletedFileCount: 0, failedFileCount: 1 }
  }
}

/**
 * 删素材的唯一执行口：先由 `planAssetDeletion` 判（摘哪些结果、文件进回收站还是留着），再照判定做。
 * - 已加载项目、要摘结果：一个撤销步（先打撤销点再改画布），文件记进待删清单、和版本删除同一次存盘落盘；
 *   真删推迟到撤销日志再也退不回这一步（`pendingAssetDeletions.ts`）。
 * - 关闭的项目：原样保留完整 payload 只替换 generationCanvas.nodes，存盘后文件当场进回收站（没有撤销可言）。
 * - 画布上没有要摘的结果（只在项目里的文件）：两条路一样，文件当场进回收站——没有撤销步，就没有可等的。
 * - 文件还被别处用着：留着，计入 keptInUseCount，由调用方告诉用户。
 */
async function deleteAssetResultUnlocked(
  asset: AssetDeletionRequest,
  loaded: ProjectExecutionContext | null,
): Promise<DeleteAssetResultOutcome> {
  const loadedProjectId = loaded ? loaded.binding.projectId : null
  const projectId = asset.origin.source === 'project' ? asset.origin.projectId : loadedProjectId
  if (!projectId) throw new Error('Asset deletion has no project to act on')
  // 「在画布 store 里改」只认发起删除时签发、且此刻仍有效的那个已加载项目；排队期间换了项目，
  // 原项目此刻已是关闭项目，走下面按项目读写盘的既有路径，绝不去改新项目的 store。
  const inLoadedStore = projectId === loadedProjectId && isProjectExecutionContextCurrent(loaded ?? undefined)
  const outcome: DeleteAssetResultOutcome = { removedResultCount: 0, deletedFileCount: 0, failedFileCount: 0, deferredFileCount: 0, keptInUseCount: 0 }

  if (inLoadedStore) {
    const store = useGenerationCanvasStore.getState()
    const plan = planAssetDeletion(asset, { projectId, nodes: store.nodes, timeline: useWorkbenchStore.getState().timeline })
    if (plan.file?.fate === 'keep') outcome.keptInUseCount = 1
    if (plan.matches.length === 0) {
      return plan.file?.fate === 'trash' ? { ...outcome, ...await trashProjectFile(plan.file.target) } : outcome
    }
    const barrierAt = getUndoJournalPosition()
    pushUndoSnapshot(store)
    const rollbacks = plan.matches.flatMap((match) => {
      const existing = store.nodes.find((node) => node.id === match.nodeId)
      if (!existing) return []
      return [{
        nodeId: match.nodeId,
        before: { result: existing.result, history: existing.history, status: existing.status, error: existing.error },
        applied: match.patch,
      }]
    })
    // 撤销点由上面那一下打（updateNode 只给提示词 / 标题 / meta 打点，结果字段不打）：一次删除 = 一个 ⌘Z。
    for (const match of plan.matches) store.updateNode(match.nodeId, match.patch)
    const deferred = plan.file?.fate === 'trash'
      ? { ...plan.file.target, journalGeneration: getUndoJournalGeneration(), journalPosition: getLatestUndoBarrierAbsolutePosition() }
      : null
    if (deferred) deferAssetFileDeletion(deferred)
    outcome.removedResultCount = countRemovedResults(plan.matches)
    try {
      const persisted = await persistActiveWorkbenchProjectNow()
      if (!persisted || persisted.id !== projectId) {
        throw new Error(`Active project result deletion could not be persisted: ${projectId}`)
      }
    } catch (error) {
      rollbackAppliedPatches(rollbacks)
      if (deferred) forgetDeferredAssetDeletion(deferred)
      // 没删成就不该留下一个「撤销了也什么都不变」的空撤销步。
      dropUndoBarriersAfter(barrierAt)
      throw error
    }
    if (deferred) outcome.deferredFileCount = 1
    return outcome
  }

  const project = await readLocalProjectAsync(projectId)
  // 读不出这个项目就说失败，不返回一个「什么都没发生」的结果让界面去猜。
  if (!project) throw new Error(`Project could not be read for asset deletion: ${projectId}`)
  const plan = planAssetDeletion(asset, { projectId, nodes: project.payload.generationCanvas.nodes, timeline: project.payload.timeline })
  if (plan.file?.fate === 'keep') outcome.keptInUseCount = 1
  if (plan.matches.length > 0) {
    await saveLocalProject(projectId, {
      ...project.payload,
      generationCanvas: {
        ...project.payload.generationCanvas,
        nodes: applyAssetResultDeletion(project.payload.generationCanvas.nodes, plan.matches),
      },
    })
    outcome.removedResultCount = countRemovedResults(plan.matches)
  }
  return plan.file?.fate === 'trash' ? { ...outcome, ...await trashProjectFile(plan.file.target) } : outcome
}


/** loaded：发起删除那一刻签发的已加载项目（没有打开的项目 = null）；不再缺省读取「当前项目」。 */
export function deleteAssetResult(
  asset: AssetDeletionRequest,
  loaded: ProjectExecutionContext | null,
  assertAuthority?: () => void,
): Promise<DeleteAssetResultOutcome> {
  const projectId = asset.origin.source === 'project' ? asset.origin.projectId : loaded?.binding.projectId
  const execute = () => {
    assertAuthority?.()
    return deleteAssetResultUnlocked(asset, loaded)
  }
  if (!projectId) return execute()
  return serializeProjectDeletion(projectId, execute)
}
