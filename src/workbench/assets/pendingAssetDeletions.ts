// Only explicit asset-library deletion owns deferred file recycling.
// Version-card removal leaves originals in project assets; legacy unmarked requests have no authority.
import { trashProjectFiles } from './assetFileDeletion'
import { logRendererError } from '../../desktop/rendererLog'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { readReachableUndoNodes, registerUndoHistoryEvictionHandler, type UndoHistoryEviction } from '../generationCanvas/events/canvasPatchHistory'
import { collectProjectFileReferences, isProjectFileReferenced, type ProjectFileReferences, type ProjectFileTarget } from './assetResultDeletion'
import { readLoadedProjectLivenessContent, type ProjectSessionMoment } from './projectLivenessContent'
import type { AssetRef } from './assetTypes'

export type PendingAssetDeletion = ProjectFileTarget & {
  source: 'asset-library'
  /** 记账时的撤销日志代号；代号变了（换了画布）= 这一步已经不可能再撤回。没有 = 从盘上读回来的遗留。 */
  journalGeneration?: number
  /** 删除这一步在撤销日志里的绝对位置（撤到这里 = 删之前）。 */
  journalPosition?: number
  /** 已经真删失败过几次。 */
  failedAttempts?: number
}

/** 存进项目文件的样子：项目自己知道自己是谁，只记相对路径（和失败过几次）。 */
export type PersistedAssetDeletion = { relativePath: string; source: 'asset-library'; failedAttempts?: number }

/** 同一份文件真删失败到第几次就放弃（文件留在盘上只占空间；不无限重试）。 */
export const MAX_DELETE_ATTEMPTS = 3

export type AssetDeletionRelease = { deletedFileCount: number; failedFileCount: number; keptReferencedCount: number }

const pending = new Map<string, PendingAssetDeletion>()
/** 已经到点、正在进回收站（deleteFiles 还没回来）的那几笔：这期间列表照样不列它。 */
const releasing = new Set<string>()
let version = 0
const listeners = new Set<() => void>()

function keyOf(target: ProjectFileTarget): string {
  return `${target.projectId}\u0000${target.relativePath}`
}

function changed(): void {
  if (!pending.size && !releasing.size) listMemo = null
  version += 1
  for (const listener of [...listeners]) listener()
}

/** 待删清单变了（记了一笔、作废、到点、真删完）就通知；列表据此重新问 `isAssetFileAwaitingTrash`。 */
export function subscribePendingAssetDeletions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function readPendingAssetDeletionsVersion(): number {
  return version
}

/** 此刻已加载项目的引用索引（读不全 = null，判定当「有人用」）。 */
function loadedProjectReferences(projectId: string, moment: ProjectSessionMoment): ProjectFileReferences | null {
  const content = readLoadedProjectLivenessContent(projectId, moment)
  return content ? collectProjectFileReferences(content.nodes, content.rest) : null
}

// 列表用的索引按「画布 store + 工作台 store 的那一刻状态」记一份：store 一变（任何字段换了引用）就重扫，同一刻的整张列表只扫一次。
let listMemo: { projectId: string; canvas: object; workbench: object; references: ProjectFileReferences | null } | null = null
function listReferences(projectId: string): ProjectFileReferences | null {
  const canvas = useGenerationCanvasStore.getState()
  const workbench = useWorkbenchStore.getState()
  if (listMemo && listMemo.projectId === projectId && listMemo.canvas === canvas && listMemo.workbench === workbench) return listMemo.references
  const references = loadedProjectReferences(projectId, 'alive')
  listMemo = { projectId, canvas, workbench, references }
  return references
}

/**
 * 这份文件是不是「已经删了、只等进回收站」：记在待删清单里（或正在进回收站），而且此刻项目里没人用它。
 * ⌘Z 把那一版撤回来 = 又有人用了，就不算（列表照常列）。引用判定与真删前那一次是同一个函数。
 */
export function isAssetFileAwaitingTrash(target: ProjectFileTarget): boolean {
  const key = keyOf(target)
  if (!pending.has(key) && !releasing.has(key)) return false
  return !isProjectFileReferenced(target, listReferences(target.projectId))
}

/** 列表用：去掉「已经删了、只等进回收站」的落盘文件。没有待删时原样返回（不新建数组，下游记忆不抖）。 */
export function withoutFilesAwaitingTrash<T extends AssetRef>(assets: readonly T[]): readonly T[] {
  if (pending.size === 0 && releasing.size === 0) return assets
  return assets.filter((asset) => asset.origin.source !== 'project' || !isAssetFileAwaitingTrash(asset.origin))
}

function commitAssetDeletionIntent(target: ProjectFileTarget): void {
  const canvas = useGenerationCanvasStore.getState()
  if (canvas.projectId === target.projectId) canvas.commitPersistedChange()
  changed()
}

export function deferAssetFileDeletion(target: PendingAssetDeletion): void {
  if (target.source !== 'asset-library') throw new Error('File deletion requires asset-library intent')
  pending.set(keyOf(target), target)
  commitAssetDeletionIntent(target)
}

/** 删除没落成（存盘失败、已回滚）：这一笔待删作废。 */
export function forgetDeferredAssetDeletion(target: ProjectFileTarget): void {
  if (pending.delete(keyOf(target))) commitAssetDeletionIntent(target)
}

/**
 * 跟着项目存盘的那份清单。待删只可能属于此刻已加载的项目：只有已加载项目的删除会延后
 * （关闭项目的删除当场删），换项目时 `releaseLoadedProjectAssetDeletions` 先把上一个项目的全部领走。
 */
export function listPersistedAssetDeletions(): PersistedAssetDeletion[] | undefined {
  if (pending.size === 0) return undefined
  return [...pending.values()].map((entry) => ({ relativePath: entry.relativePath, source: entry.source, ...(entry.failedAttempts ? { failedAttempts: entry.failedAttempts } : {}) }))
}

function take(predicate: (entry: PendingAssetDeletion) => boolean): PendingAssetDeletion[] {
  const due = [...pending.values()].filter(predicate)
  for (const entry of due) pending.delete(keyOf(entry))
  return due
}

/**
 * 删失败的那一笔记一次失败、放回清单（只在这个项目还开着时放回——它的清单随项目存盘；
 * 换项目那一刻的失败不放回内存，项目文件里那一笔还在，下次打开再试）。到上限就放弃。
 */
function requeueFailed(entry: PendingAssetDeletion, requeue: boolean): void {
  const failedAttempts = (entry.failedAttempts ?? 0) + 1
  if (failedAttempts >= MAX_DELETE_ATTEMPTS) {
    logRendererError('pending-asset-deletion-gave-up', new Error(`${entry.relativePath} failed ${failedAttempts} times`))
    return
  }
  if (requeue) pending.set(keyOf(entry), { projectId: entry.projectId, relativePath: entry.relativePath, source: entry.source, failedAttempts })
}

/** 到点的逐条再判一次引用：没人用了才删；有人用（撤销回来了 / 别处在用 / 读不全）只销账。 */
async function release(due: readonly PendingAssetDeletion[], requeue: boolean, moment: ProjectSessionMoment): Promise<AssetDeletionRelease> {
  const outcome: AssetDeletionRelease = { deletedFileCount: 0, failedFileCount: 0, keptReferencedCount: 0 }
  if (due.length === 0) return outcome
  // 进回收站这一路上（deleteFiles 还没回来）列表照样不列它；回来以后由主进程的删除广播刷新列表。
  for (const entry of due) releasing.add(keyOf(entry))
  try {
    // 引用判定读的是此刻已加载项目的整份内容，同步、在第一个 await 之前；条目不是此刻载入的项目的 → 读不到 → 保留。
    // 同一批到点的按项目各扫一次（不随条目数线性变慢）。
    const byProject = new Map<string, ProjectFileReferences | null>()
    const referencesOf = (projectId: string) => {
      if (!byProject.has(projectId)) byProject.set(projectId, loadedProjectReferences(projectId, moment))
      return byProject.get(projectId) ?? null
    }
    const unreferenced = due.filter((entry) => !isProjectFileReferenced(entry, referencesOf(entry.projectId)))
    outcome.keptReferencedCount = due.length - unreferenced.length
    if (unreferenced.length === 0) return outcome
    for (const entry of unreferenced) {
      try {
        const result = await trashProjectFiles(entry.projectId, [entry.relativePath])
        outcome.deletedFileCount += result.deletedCount
        outcome.failedFileCount += result.failedCount
        if (result.failedCount > 0) requeueFailed(entry, requeue)
      } catch (error) {
        outcome.failedFileCount += 1
        logRendererError('pending-asset-deletion-failed', error)
        requeueFailed(entry, requeue)
      }
    }
    return outcome
  } finally {
    for (const entry of due) releasing.delete(keyOf(entry))
    changed()
  }
}

/** 撤销日志挤出了最老的几步：只放行「那一步本身已经退不回去」的待删。 */
export function releaseEvictedAssetDeletions(eviction: UndoHistoryEviction): Promise<AssetDeletionRelease> {
  const discarded = new Set(eviction.discardedPositions)
  const due = take(entry => entry.journalGeneration === eviction.generation && entry.journalPosition !== undefined
    && (discarded.has(entry.journalPosition) || entry.journalPosition < eviction.oldestReachablePosition))
  const expired = due.filter(entry => {
    if (isProjectFileReferenced(entry, listReferences(entry.projectId))) return false
    for (const frame of readReachableUndoNodes()) {
      if (isProjectFileReferenced(entry, collectProjectFileReferences(frame.nodes, {}))) {
        pending.set(keyOf(entry), { ...entry, journalPosition: frame.position })
        return false
      }
    }
    return true
  })
  if (due.length) changed()
  // Claim expired requests synchronously. A branch-opening edit can publish new
  // live references before recycling starts, so check the project again after it.
  return Promise.resolve().then(() => release(expired, true, 'alive'))
}

/**
 * 换项目 / 关项目：这个项目的撤销日志马上清零，它的待删全部到点。必须在画布 store 换成下一个项目
 * **之前**同步调用——引用判定读的是此刻的画布（`take` 和判定都在第一个 await 之前完成）。
 */
export function releaseLoadedProjectAssetDeletions(): Promise<AssetDeletionRelease> {
  listMemo = null
  // 撤销栈随后清零：会话撤销材料这一次不算「有人用」，不然文件永远删不掉。
  return release(take(() => true), false, 'ending')
}

/**
 * 打开项目：上次没来得及删的（App 直接退出）、上次删失败的，现在删。只认清单里记过的路径，不扫目录。
 * 清扫完清单变了（删掉了 / 失败次数加一）就请画布存一次盘，项目文件里的清单跟着变——否则失败次数永远停在
 * 旧值，每次打开都再试一遍，上限形同虚设。
 */
export async function sweepPersistedAssetDeletions(projectId: string, persisted: unknown, onListChanged?: () => void): Promise<AssetDeletionRelease> {
  const entries = Array.isArray(persisted)
    ? persisted.flatMap((entry): PendingAssetDeletion[] => {
        const raw = entry && typeof entry === 'object' ? entry as { relativePath?: unknown; failedAttempts?: unknown; source?: unknown } : {}
        const failedAttempts = Number.isInteger(raw.failedAttempts) && (raw.failedAttempts as number) > 0 ? raw.failedAttempts as number : undefined
        return raw.source === 'asset-library' && typeof raw.relativePath === 'string' && raw.relativePath.trim()
          ? [{ projectId, source: 'asset-library', relativePath: raw.relativePath, ...(failedAttempts ? { failedAttempts } : {}) }]
          : []
      })
    : []
  const outcome = await release(entries, true, 'alive')
  if (entries.length > 0) onListChanged?.()
  return outcome
}

registerUndoHistoryEvictionHandler((eviction) => {
  void releaseEvictedAssetDeletions(eviction).catch((error: unknown) => logRendererError('pending-asset-deletion-release-failed', error))
})

export function __resetPendingAssetDeletionsForTests(): void {
  listMemo = null
  pending.clear()
  releasing.clear()
  listeners.clear()
}
