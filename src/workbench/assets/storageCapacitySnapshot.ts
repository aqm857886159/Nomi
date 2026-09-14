// 渲染层的磁盘余量快照 —— 导入预检用。
//
// 为什么渲染层也要知道：预检是为了**别白建节点**（拖 10 个文件进画布，装不下的那两个不该先长出
// 节点再变红）。权威闸仍在主进程落盘前（localFileImport.assertAdmitted），两边调的是同一个
// admitMediaImport，所以不是并行版，是同一份判断的两个调用者。
import { getDesktopBridge } from '../../desktop/bridge'
import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import type { StorageCapacity } from '../../../electron/shared/contracts/mediaImportPolicy'

const TTL_MS = 5_000
let cached: { at: number; projectId: string; capacity: StorageCapacity | null } | null = null

/** 取磁盘余量。桥不可用 / 量不到 → null（= 未知，不当拒绝理由，交给落盘时的真实错误）。 */
export async function readStorageCapacitySnapshot(projectId?: string | null): Promise<StorageCapacity | null> {
  const id = String(projectId || getDesktopActiveProjectId() || '').trim()
  if (!id) return null
  if (cached && cached.projectId === id && Date.now() - cached.at < TTL_MS) return cached.capacity
  const read = getDesktopBridge()?.assets?.storageCapacity
  if (!read) return null
  try {
    const capacity = await read({ projectId: id })
    cached = { at: Date.now(), projectId: id, capacity: capacity ?? null }
    return cached.capacity
  } catch {
    return null
  }
}

export function clearStorageCapacitySnapshot(): void {
  cached = null
}
