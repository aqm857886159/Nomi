// 任务优先重构（2026-07-22 审计 §6 + 用户拍板样张）：进 3D 不先学系统，先选产物。
// 三个任务入口共用同一套编辑器状态（绝不另造并行导演台）；本文件是纯函数层——
// 任务词汇、CTA 文案、全局状态句推导，配单测。
import i18n from '../../../../i18n'

export type Scene3DTaskMode = 'compose' | 'act' | 'move'

export const SCENE3D_TASK_ORDER: Scene3DTaskMode[] = ['compose', 'act', 'move']

// 任务标签用函数取（不是模块级 const）——否则切换语言后旧值不更新。
export const scene3dTaskLabel = (task: Scene3DTaskMode): string => i18n.t(`scene3d.taskFlow.taskLabel.${task}`)
export const scene3dTaskShortLabel = (task: Scene3DTaskMode): string => i18n.t(`scene3d.taskFlow.taskShortLabel.${task}`)

// CTA 随任务与录制态变：act 任务在录制中变成「完成这段动作」。
export function scene3dTaskCta(task: Scene3DTaskMode, recording: boolean): string {
  if (task === 'act') return recording ? i18n.t('scene3d.taskFlow.actCtaFinish') : i18n.t('scene3d.taskFlow.actCtaStart')
  return task === 'compose' ? i18n.t('scene3d.taskFlow.composeCta') : i18n.t('scene3d.taskFlow.moveCta')
}

export type Scene3DStatusInput = {
  recording: boolean
  recordingSeconds: number
  countdownRemaining: number | null
  possessedName: string | null
  possessedCameraName: string | null
  cameraViewEditName: string | null
  trajectoryMode: boolean
  isPlaying: boolean
  selectionName: string | null
  selectionKind: 'object' | 'camera' | null
}

// 任一时刻只显示一句全局状态（审计 §6.2）：录制 > 倒计时 > 接控 > 取景 > 播放 > 轨迹 > 选中 > 空。
// 用户在任何截图里都能从这一句说出「现在控制谁」。
export function scene3dStatusSentence(input: Scene3DStatusInput): string {
  if (input.recording) {
    const owner = input.possessedName || input.possessedCameraName || i18n.t('scene3d.taskFlow.status.ownerScene')
    const driver = input.possessedCameraName && !input.possessedName
      ? i18n.t('scene3d.taskFlow.status.driverCamera')
      : i18n.t('scene3d.taskFlow.status.driverCharacter')
    return i18n.t('scene3d.taskFlow.status.recording', { owner, driver })
  }
  if (input.countdownRemaining !== null) return i18n.t('scene3d.taskFlow.status.countdown', { seconds: input.countdownRemaining })
  if (input.possessedName) return i18n.t('scene3d.taskFlow.status.possessCharacter', { name: input.possessedName })
  if (input.possessedCameraName) return i18n.t('scene3d.taskFlow.status.possessCamera', { name: input.possessedCameraName })
  if (input.cameraViewEditName) return i18n.t('scene3d.taskFlow.status.framing', { name: input.cameraViewEditName })
  if (input.isPlaying) return i18n.t('scene3d.taskFlow.status.playing')
  if (input.trajectoryMode) return i18n.t('scene3d.taskFlow.status.trajectory')
  if (input.selectionName) {
    return input.selectionKind === 'camera'
      ? i18n.t('scene3d.taskFlow.status.selectedCamera', { name: input.selectionName })
      : i18n.t('scene3d.taskFlow.status.movingObject', { name: input.selectionName })
  }
  return i18n.t('scene3d.taskFlow.status.idle')
}

// 场景树分段：连续同 templateGroup 的对象聚成一段（组折叠渲染），散件保持原序透传。
export function templateGroupSegments<T extends { templateGroup?: string }>(
  items: readonly T[],
): Array<{ group: string | null; items: T[] }> {
  const segments: Array<{ group: string | null; items: T[] }> = []
  for (const item of items) {
    const group = item.templateGroup || null
    const last = segments[segments.length - 1]
    if (last && last.group === group) last.items.push(item)
    else segments.push({ group, items: [item] })
  }
  return segments
}

// 主视图身份 chip（审计 §6.2：不能只靠小预览暗示）：
// 取景态 = 所选相机就是输出画面；否则 = 导演工作视图，明说「不会出片」。
export function scene3dViewIdentityLabel(
  cameraViewEditName: string | null,
  cameraAspect: string | null,
): { label: string; isOutput: boolean } {
  if (cameraViewEditName) {
    const name = `${cameraViewEditName}${cameraAspect ? ` · ${cameraAspect}` : ''}`
    return { label: i18n.t('scene3d.taskFlow.outputViewLabel', { name }), isOutput: true }
  }
  return { label: i18n.t('scene3d.taskFlow.workViewLabel'), isOutput: false }
}
