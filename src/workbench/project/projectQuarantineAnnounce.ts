import type { TFunction } from 'i18next'
import i18n from '../../i18n'
import { getDesktopBridge } from '../../desktop/bridge'
import { logRendererError } from '../../desktop/rendererLog'
import { toast, useToastStore } from '../../ui/toast'
import { projectOperationFailureText, projectQuarantineNoticeText, projectQuarantineRevealLabel } from './projectOperationFailureText'
import { takeQuarantineNotice } from './projectRepository'

type RevealFile = (payload: { projectId: string; relativePath: string }) => Promise<unknown>

/**
 * 有项被隔离时的那句提醒：保存成功后、项目打开后各问一次（projectPersistenceService）。
 * 说哪些由 projectRepository.takeQuarantineNotice 定（保存时同一份内容不说第二次；打开时每次会话说一次）。
 * 显示交给现有提示件 toast：提醒色（warning，不是报错）；这一批几项都只出一条（「有 N 处」）；
 * 不自动消失（ttl: false）——自动保存在后台发生，创作者可能没在看，这句话错过了就没有第二次，要等他自己关掉或点按钮。
 * 桌面端带「打开所在文件夹」，直通另存的那一份；没有桌面桥（浏览器预览没有隔离目录）就只有那句话。不另造显示组件。
 */
export function announceQuarantine(
  projectId: string,
  t: TFunction = i18n.t.bind(i18n) as TFunction,
  reveal: RevealFile | undefined = getDesktopBridge()?.workspace?.revealFile,
): boolean {
  const items = takeQuarantineNotice(projectId)
  if (!items.length) return false
  const relativePath = items[0]!.relativePath
  const id = `project-quarantine:${projectId}:${relativePath}`
  const message = projectQuarantineNoticeText(t, items)
  const action = reveal && relativePath
    ? {
        actionLabel: projectQuarantineRevealLabel(t),
        onAction: () => {
          void reveal({ projectId, relativePath }).catch((error: unknown) => {
            logRendererError('project-reveal-quarantine-failed', error)
            toast(projectOperationFailureText('revealFolder', error, t), 'error', `${id}:reveal`)
          })
        },
      }
    : {}
  useToastStore.getState().push({ id, message, reason: 'project-quarantine', type: 'warning', ttl: false, dismissible: true, ...action })
  return true
}
