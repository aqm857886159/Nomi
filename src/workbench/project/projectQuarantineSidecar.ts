import { getDesktopBridge } from '../../desktop/bridge'
import { unwrapIpcResult } from '../../../electron/shared/contracts/ipcResult'
import type { QuarantineWriteOutcome } from '../../../electron/shared/contracts/projectSaveFailure'
import type { QuarantinedItem } from './projectNormalize'

export type QuarantineFile = QuarantineWriteOutcome['files'][number]

/**
 * 把被隔离那一项的原样内容原子写进项目自己的隔离区（主进程 `nomi:projects:quarantine-write`）。
 * 返回每项落在哪个文件、是不是这次新写的（同一份内容早已在 → fresh=false，界面据此只提示一次）。
 * **写不成就抛**（IpcResultError，reason 是保存失败同一套原因）：调用方这次不覆盖项目文件。
 * 没有桌面桥（浏览器预览）没有项目文件夹，返回空。
 */
export async function writeQuarantineSidecar(projectId: string, items: readonly QuarantinedItem[]): Promise<readonly QuarantineFile[]> {
  if (!items.length) return []
  const write = getDesktopBridge()?.projects.quarantineWrite
  if (!write) return []
  const result = await write(projectId, items.map(({ container, field, raw }) => ({ container, field, raw })))
  return unwrapIpcResult(result, 'nomi:projects:quarantine-write').files
}
