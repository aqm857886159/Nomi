import { rollbackAppliedPatches, serializeProjectDeletion } from './assetResultMutation'
import { trashProjectFiles } from './assetFileDeletion'
import { logRendererError } from '../../desktop/rendererLog'
import { readLocalProjectAsync, saveLocalProject } from '../library/localProjectStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { persistActiveWorkbenchProjectNow } from '../project/workbenchProjectSession'
import { applyAssetResultDeletion, countRemovedResults, planAssetDeletion, type ProjectFileTarget, type AssetDeletionRequest } from './assetResultDeletion'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import {
  dropUndoBarriersAfter,
  getLatestUndoBarrierAbsolutePosition,
  getUndoJournalGeneration,
  getUndoJournalPosition,
  pushUndoSnapshot,
  readReachableUndoNodes,
} from '../generationCanvas/events/canvasPatchHistory'
import { deferAssetFileDeletion, forgetDeferredAssetDeletion } from './pendingAssetDeletions'
import { closedProjectLivenessContent, readLoadedProjectLivenessContent } from './projectLivenessContent'

export type DeleteAssetResultOutcome = {
  /** 从画布卡上摘掉的结果数（卡本身保留）。 */
  removedResultCount: number
  /** 当场进了系统回收站的文件数。 */
  deletedFileCount: number
  /** 进回收站失败的文件数（被占用、没权限、没有桌面桥）。 */
  failedFileCount: number
  /** 文件没当场删、等撤销窗口过去再删（摘结果或仅被撤销材料引用）。 */
  deferredFileCount: number
  /** 这张素材的文件项目里还有别处用着（分镜参考、节点参考、助手输入、时间轴、白板、别的结果……），留着没删。 */
  keptInUseCount: number
}

/** 文件当场进系统回收站（没有撤销步可挂的删除：关闭的项目，或当前/撤销内容都无人用的纯文件）。 */
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
 * - 画布上没有要摘的结果：只被可达撤销材料引用的文件绑定原撤销步延后回收；无人用的当场回收。
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
    // 判定读整份项目内容；读不全（rest = null）判定一律保留文件，结果照样能摘。
    const live = readLoadedProjectLivenessContent(projectId, 'alive')
    const plan = planAssetDeletion(asset, { projectId, nodes: store.nodes, rest: live ? live.rest : null, undo: readReachableUndoNodes() })
    if (plan.file?.fate === 'keep') outcome.keptInUseCount = 1
    if (plan.matches.length === 0 && plan.file?.fate !== 'defer') {
      return plan.file?.fate === 'trash' ? { ...outcome, ...await trashProjectFile(plan.file.target) } : outcome
    }
    const barrierAt = getUndoJournalPosition()
    if (plan.matches.length > 0) pushUndoSnapshot(store)
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
    const deferred = plan.file && plan.file.fate !== 'keep'
      ? { ...plan.file.target, source: 'asset-library' as const, journalGeneration: getUndoJournalGeneration(),
          journalPosition: plan.file.fate === 'defer' ? plan.file.journalPosition : getLatestUndoBarrierAbsolutePosition() }
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
      if (plan.matches.length > 0) dropUndoBarriersAfter(barrierAt)
      throw error
    }
    if (deferred) outcome.deferredFileCount = 1
    return outcome
  }

  const project = await readLocalProjectAsync(projectId)
  // 读不出这个项目就说失败，不返回一个「什么都没发生」的结果让界面去猜。
  if (!project) throw new Error(`Project could not be read for asset deletion: ${projectId}`)
  const plan = planAssetDeletion(asset, { projectId, ...closedProjectLivenessContent(project.payload) })
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
