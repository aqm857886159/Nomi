import type { TFunction } from 'i18next'
import { isWorkspaceBusyError } from '../../../electron/shared/contracts/workspaceBusy'

/**
 * 保存失败时给用户看哪一句——四条保存路径（自动保存、改名后保存、关窗、刷新）共用这一处。
 * 锁被别处占着（另一个 Nomi 窗口 / 另一台电脑经同步盘）不是磁盘权限问题，不能再把人支去查权限。
 */
export function projectSaveFailureText(error: unknown, t: TFunction): string {
  return isWorkspaceBusyError(error) ? t('studio.projectInUseElsewhere') : t('studio.projectSaveFailed')
}
