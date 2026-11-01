import type { TFunction } from 'i18next'

import type { ProjectDeleteIntent } from '../../../electron/shared/projectDeleteIntent'
import { projectDeleteChoice } from './projectDeleteChoice'
import { trashBinKey } from '../project/projectOperationFailureText'

/**
 * 项目库删除一个项目的完整流程（确认 → 必要时释放当前项目 → 交给主进程 → 成功 / 失败提示）。
 *
 * 从 NomiStudioApp 抽出来，好让「卡片状态 → 确认框文案 → 交给主进程的意图」整条链能在组件外被测
 * （V-plibrary2 第 3 轮建议：灰卡点删除，断言传的是「只移除」）。依赖全部注入，这里不碰 React / 桥。
 *
 * 删除文件 = 进系统回收站（⑭）：确认框、成功提示、失败提示都按平台说「回收站 / 废纸篓」。
 * 删的是正打开的项目时，先释放它；之后不论成败都回项目库（失败时项目还在，卡片上显示原因）。
 * 成功提示按**主进程真说了什么**弹，不按「用户点了删除」弹（V-library-trash 建议 2）：`deleted: true` 才是「文件夹进了回收站」；
 * 确认的是删除文件、主进程却回 false（文件夹已被挪走、库页没刷新；或其实是外部文件夹），只摘了登记、没有东西进回收站，
 * 这时如实说「只从项目库移除了」，不说「已移到回收站」。
 */
export type ProjectDeleteTarget = { id: string; name: string; source?: string; unreadableReason?: string; missing?: boolean }

export type ProjectDeleteFlowDeps = {
  t: TFunction
  platform: string | undefined
  confirm: (options: { title: string; message: string; confirmLabel: string; danger: true }) => Promise<boolean>
  isActive: (projectId: string) => boolean
  releaseActive: () => Promise<void>
  leaveToLibrary: () => void
  /** 返回主进程说的结果：`deleted: true` = 项目文件夹真的进了回收站；false = 只摘了登记。 */
  deleteLocalProject: (projectId: string, intent: ProjectDeleteIntent) => Promise<{ deleted: boolean }>
  onMovedToTrash: (message: string) => void
  onRemovedWithoutTrash: (message: string) => void
  onFailed: (projectId: string, error: unknown, trashBin: string) => void
}

export async function runProjectDeleteFlow(project: ProjectDeleteTarget, deps: ProjectDeleteFlowDeps): Promise<void> {
  const { t } = deps
  const choice = projectDeleteChoice(project)
  const bin = t(trashBinKey(deps.platform))
  const confirmed = await deps.confirm({
    title: t(choice.titleKey),
    message: t(choice.messageKey, { name: project.name, bin }),
    confirmLabel: t(choice.confirmLabelKey),
    danger: true,
  })
  if (!confirmed) return
  const wasActive = deps.isActive(project.id)
  try {
    // 删的是正打开的项目：先拿到主进程的释放回执，旧的画布读路由不能活得比项目久。
    if (wasActive) await deps.releaseActive()
    // 主进程只照用户在这个确认框里确认的那一种执行：说了「只移除」就绝不删文件（V-plibrary2）。
    const result = await deps.deleteLocalProject(project.id, choice.intent)
    if (choice.intent === 'delete-files') {
      if (result.deleted) deps.onMovedToTrash(t('studio.projectMovedToTrash', { name: project.name, bin }))
      else deps.onRemovedWithoutTrash(t('studio.projectRemovedWithoutTrash', { name: project.name, bin }))
    }
  } catch (error: unknown) {
    deps.onFailed(project.id, error, bin)
  } finally {
    if (wasActive) deps.leaveToLibrary()
  }
}
