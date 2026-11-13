import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../desktop/bridge'
import { logRendererError } from '../../desktop/rendererLog'
import { notify } from '../../ui/notificationPolicy'
import { projectOperationFailureText, projectQuarantineNoticeText, projectQuarantineRevealLabel, type UserText } from './projectOperationFailureText'
import { takeQuarantineNotice } from './projectRepository'

/**
 * 有项被隔离时，原有保存状态那一行显示的那句提醒（提醒，不是报错）+「打开所在文件夹」。
 * 和原来的红色失败提示一起从 NomiStudioApp 挪出来（文件体积门岗），位置、样式、文案都没变。
 */
export type QuarantineFeedback = { projectId: string | null; message: string; tone: 'quarantine'; revealPath?: string }

/** 打开 / 保存之后取这个项目「新另存、还没说过」的被隔离项，说一次（同一份内容不再说第二次：projectRepository.takeQuarantineNotice）。 */
export function useAnnounceQuarantine(present: (feedback: QuarantineFeedback) => void): (projectId: string) => void {
  const { t } = useTranslation()
  return React.useCallback((projectId: string) => {
    const items = takeQuarantineNotice(projectId)
    if (!items.length) return
    const revealPath = items[0]!.relativePath
    notify({
      identity: `project:${projectId}`, reason: 'operation', level: 'inline', message: projectQuarantineNoticeText(t, items), type: 'warning',
      present: (message) => present({ projectId, message, tone: 'quarantine', revealPath }),
    })
  }, [present, t])
}

/** 原有保存状态那一行：普通失败是红色 alert（原样搬过来），有项被隔离是下面这句提醒。 */
export function ProjectFeedbackLine({ feedback, report }: {
  feedback: { projectId: string | null; message: string } | QuarantineFeedback
  report: (projectId: string | null, message: UserText) => void
}): React.JSX.Element {
  if (!('tone' in feedback)) return <p role="alert" className="m-0 px-4 py-2 text-caption text-nomi-danger">{feedback.message}</p>
  return <ProjectQuarantineNotice feedback={feedback} report={report} />
}

function ProjectQuarantineNotice({ feedback, report }: {
  feedback: QuarantineFeedback
  report: (projectId: string | null, message: UserText) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const reveal = getDesktopBridge()?.workspace?.revealFile
  const { projectId, revealPath } = feedback
  const revealQuarantine = () => {
    if (!projectId || !revealPath || !reveal) return
    void reveal({ projectId, relativePath: revealPath }).catch((error: unknown) => {
      logRendererError('project-reveal-quarantine-failed', error)
      report(projectId, projectOperationFailureText('revealFolder', error, t))
    })
  }
  return (
    <div role="status" data-testid="project-quarantine-notice" className="m-0 flex items-start gap-3 bg-nomi-warning-soft px-4 py-2 text-caption text-nomi-warning-ink">
      <p className="m-0 min-w-0 flex-1">{feedback.message}</p>
      {revealPath && reveal ? (
        <button type="button" className="shrink-0 rounded-nomi-sm px-1.5 font-medium text-nomi-warning-ink underline underline-offset-2 hover:bg-nomi-warning-edge" onClick={revealQuarantine}>
          {projectQuarantineRevealLabel(t)}
        </button>
      ) : null}
    </div>
  )
}
