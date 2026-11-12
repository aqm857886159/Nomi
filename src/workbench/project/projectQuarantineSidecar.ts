import { getDesktopBridge } from '../../desktop/bridge'
import { logRendererWarn } from '../../desktop/rendererLog'
import type { QuarantinedItem } from './projectNormalize'

/**
 * 把被隔离那一项的原样内容留进项目自己的隔离区（主进程 `nomi:projects:quarantine-write`，按内容哈希去重）。
 * 只是「留一份、方便找回」：写不进不影响保存，也不抛。日志只记数量，不记内容。
 */
export async function writeQuarantineSidecar(projectId: string, items: readonly QuarantinedItem[]): Promise<void> {
  if (!items.length) return
  const write = getDesktopBridge()?.projects.quarantineWrite
  if (!write) return
  try {
    await write(projectId, items.map(({ container, field, raw }) => ({ container, field, raw })))
  } catch {
    logRendererWarn('project-quarantine-sidecar-failed', { count: items.length })
  }
}
