import type { WorkspaceMode } from '../../workbenchStore'
import { laneFailureText } from '../lane/laneCommandFailure'

export type ResidentSurface = Extract<WorkspaceMode, 'creation' | 'storyboard' | 'generation' | 'preview'>
type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * 面板顶部那条红色横幅上印的字。
 *
 * 判据整个住在 `laneCommandFailure.laneFailureText`（lane 码 → 本地化文案；未分类的原始串
 * 只进 console）。这里留下的只有两条**这一层特有**的归一：`project_agent_unavailable` /
 * `project_binding_stale` 在产品语义上是同一句「这个项目的 Agent 现在用不了」，不按码分两句。
 */
export function friendlyError(error: unknown, t: Translate): string {
  const code = error instanceof Error ? error.message.trim() : ''
  if (code === 'project_agent_unavailable' || code === 'project_binding_stale') return t('agentResident.unavailable')
  return laneFailureText(error, t)
}
