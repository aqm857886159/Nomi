// 被删掉的那一版，它的文件「什么时候真从盘上删」——唯一 owner。
//
// 删一版不弹确认框、给撤销（用户 2026-09-28 拍板），所以文件不能当场删：⌘Z 把版本找回来时文件得还在。
// 规则：
// 1. 删的时候只从版本列表里拿掉并存盘，文件记一笔「待删」，带上这一步在撤销日志里的位置；
// 2. 撤销日志再也退不回这一步（被挤出 80 步）时，才真删；
// 3. 换项目 / 关项目（撤销日志清零）时，这个项目的待删全部到点；
// 4. 待删清单跟着项目一起存盘（payload.pendingAssetDeletions）：App 直接退出来不及删的，
//    下次打开这个项目时清扫（那时撤销日志是空的，没有任何一步能退回去）。
// 每次真删之前都用 `isProjectFileReferenced` 再判一次：撤销回来的、时间轴还在用的，一律不删，只销账。
// 真删失败（文件被占用、权限）不销账：留在清单里下次到点再试，连续失败 MAX_DELETE_ATTEMPTS 次才放弃并记日志。
// 列表也问这里（`isAssetFileAwaitingTrash`）：已经删了、只等撤销窗口过去的文件，素材库两个页签都不再列它
// （2026-10-24 之前列表按盘上文件把它列回来、换成文件名，删了像没删）。
import { trashProjectFiles } from './assetFileDeletion'
import { logRendererError } from '../../desktop/rendererLog'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { registerUndoHistoryEvictionHandler, type UndoHistoryEviction } from '../generationCanvas/events/canvasUndoJournal'
import { isProjectFileReferenced, type ProjectFileTarget } from './assetResultDeletion'
import type { AssetRef } from './assetTypes'

export type PendingAssetDeletion = ProjectFileTarget & {
  /** 记账时的撤销日志代号；代号变了（换了画布）= 这一步已经不可能再撤回。没有 = 从盘上读回来的遗留。 */
  journalGeneration?: number
  /** 删除这一步在撤销日志里的绝对位置（撤到这里 = 删之前）。 */
  journalPosition?: number
  /** 已经真删失败过几次。 */
  failedAttempts?: number
}

/** 存进项目文件的样子：项目自己知道自己是谁，只记相对路径（和失败过几次）。 */
export type PersistedAssetDeletion = { relativePath: string; failedAttempts?: number }

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

/**
 * 这份文件是不是「已经删了、只等进回收站」：记在待删清单里（或正在进回收站），而且此刻画布 / 时间轴
 * 没人用它。⌘Z 把那一版撤回来 = 又有人用了，就不算（列表照常列）。引用判定与真删前那一次是同一个函数。
 */
export function isAssetFileAwaitingTrash(target: ProjectFileTarget): boolean {
  const key = keyOf(target)
  if (!pending.has(key) && !releasing.has(key)) return false
  return !isProjectFileReferenced(target, { nodes: useGenerationCanvasStore.getState().nodes, timeline: useWorkbenchStore.getState().timeline })
}

/** 列表用：去掉「已经删了、只等进回收站」的落盘文件。没有待删时原样返回（不新建数组，下游记忆不抖）。 */
export function withoutFilesAwaitingTrash<T extends AssetRef>(assets: readonly T[]): readonly T[] {
  if (pending.size === 0 && releasing.size === 0) return assets
  return assets.filter((asset) => asset.origin.source !== 'project' || !isAssetFileAwaitingTrash(asset.origin))
}

export function deferAssetFileDeletion(target: PendingAssetDeletion): void {
  pending.set(keyOf(target), target)
  changed()
}

/** 删除没落成（存盘失败、已回滚）：这一笔待删作废。 */
export function forgetDeferredAssetDeletion(target: ProjectFileTarget): void {
  if (pending.delete(keyOf(target))) changed()
}

/**
 * 跟着项目存盘的那份清单。待删只可能属于此刻已加载的项目：只有已加载项目的删除会延后
 * （关闭项目的删除当场删），换项目时 `releaseLoadedProjectAssetDeletions` 先把上一个项目的全部领走。
 */
export function listPersistedAssetDeletions(): PersistedAssetDeletion[] | undefined {
  if (pending.size === 0) return undefined
  return [...pending.values()].map((entry) => ({ relativePath: entry.relativePath, ...(entry.failedAttempts ? { failedAttempts: entry.failedAttempts } : {}) }))
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
  if (requeue) pending.set(keyOf(entry), { projectId: entry.projectId, relativePath: entry.relativePath, failedAttempts })
}

/** 到点的逐条再判一次引用：没人用了才删；有人用（撤销回来了 / 时间轴在用）只销账。 */
async function release(due: readonly PendingAssetDeletion[], requeue: boolean): Promise<AssetDeletionRelease> {
  const outcome: AssetDeletionRelease = { deletedFileCount: 0, failedFileCount: 0, keptReferencedCount: 0 }
  if (due.length === 0) return outcome
  // 进回收站这一路上（deleteFiles 还没回来）列表照样不列它；回来以后由主进程的删除广播刷新列表。
  for (const entry of due) releasing.add(keyOf(entry))
  try {
    // 引用判定读的是此刻已加载项目的画布与时间轴——调用方保证到点的都是这个项目的（见各入口）。
    const scope = { nodes: useGenerationCanvasStore.getState().nodes, timeline: useWorkbenchStore.getState().timeline }
    const unreferenced = due.filter((entry) => !isProjectFileReferenced(entry, scope))
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
  return release(take((entry) => (
    entry.journalGeneration === eviction.generation
    && entry.journalPosition !== undefined
    && entry.journalPosition < eviction.oldestReachablePosition
  )), true)
}

/**
 * 换项目 / 关项目：这个项目的撤销日志马上清零，它的待删全部到点。必须在画布 store 换成下一个项目
 * **之前**同步调用——引用判定读的是此刻的画布（`take` 和判定都在第一个 await 之前完成）。
 */
export function releaseLoadedProjectAssetDeletions(): Promise<AssetDeletionRelease> {
  return release(take(() => true), false)
}

/**
 * 打开项目：上次没来得及删的（App 直接退出）、上次删失败的，现在删。只认清单里记过的路径，不扫目录。
 * 清扫完清单变了（删掉了 / 失败次数加一）就请画布存一次盘，项目文件里的清单跟着变——否则失败次数永远停在
 * 旧值，每次打开都再试一遍，上限形同虚设。
 */
export async function sweepPersistedAssetDeletions(projectId: string, persisted: unknown, onListChanged?: () => void): Promise<AssetDeletionRelease> {
  const entries = Array.isArray(persisted)
    ? persisted.flatMap((entry): PendingAssetDeletion[] => {
        const raw = entry && typeof entry === 'object' ? entry as { relativePath?: unknown; failedAttempts?: unknown } : {}
        const failedAttempts = Number.isInteger(raw.failedAttempts) && (raw.failedAttempts as number) > 0 ? raw.failedAttempts as number : undefined
        return typeof raw.relativePath === 'string' && raw.relativePath.trim()
          ? [{ projectId, relativePath: raw.relativePath, ...(failedAttempts ? { failedAttempts } : {}) }]
          : []
      })
    : []
  const outcome = await release(entries, true)
  if (entries.length > 0) onListChanged?.()
  return outcome
}

registerUndoHistoryEvictionHandler((eviction) => {
  void releaseEvictedAssetDeletions(eviction).catch((error: unknown) => logRendererError('pending-asset-deletion-release-failed', error))
})

export function __resetPendingAssetDeletionsForTests(): void {
  pending.clear()
  releasing.clear()
  listeners.clear()
}
