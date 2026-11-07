import type { ProjectDeleteIntent } from '../../../electron/shared/projectDeleteIntent'

/**
 * 删除确认框说什么、确认后交给主进程什么意图——**同一个判断出两样**（V-plibrary2 T1）。
 *
 * 以前文案和意图在调用点各算各的（`isExternal ? … : …` 写了两遍），审查线把意图那一处改成一律
 * `delete-files`，测试照样全绿：确认框说「只移除、不删文件」，主进程却收到「删文件」。现在两样都只从这里出，
 * 「文案说移除、意图是删文件」在这里写不出来；单测 `projectDeleteChoice.test.ts` 钉住每种卡片状态。
 *
 * 只移除（unbind）：外部「打开文件夹」绑定的项目（不是我们的目录）、数据读不出来的项目（读不清楚的目录不能当成自己的去删），
 * 以及文件夹找不到的项目（没有东西可进回收站，确认框不能说「会移到回收站」）。
 * 其余（读得出来的本地项目）：删除文件。
 */
export type ProjectDeleteChoice = {
  intent: ProjectDeleteIntent
  titleKey: 'studio.removeProjectTitle' | 'studio.deleteProjectTitle'
  messageKey: 'studio.removeProjectMessage' | 'studio.deleteProjectMessage'
  confirmLabelKey: 'studio.removeProject' | 'common.delete'
}

export function projectDeleteChoice(project: { source?: string; unreadableReason?: string; missing?: boolean }): ProjectDeleteChoice {
  const unbindOnly = project.source === 'folder' || Boolean(project.unreadableReason) || Boolean(project.missing)
  return unbindOnly
    ? { intent: 'unbind', titleKey: 'studio.removeProjectTitle', messageKey: 'studio.removeProjectMessage', confirmLabelKey: 'studio.removeProject' }
    : { intent: 'delete-files', titleKey: 'studio.deleteProjectTitle', messageKey: 'studio.deleteProjectMessage', confirmLabelKey: 'common.delete' }
}
