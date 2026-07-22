// 任务优先重构（2026-07-22 审计 §6 + 用户拍板样张）：进 3D 不先学系统，先选产物。
// 三个任务入口共用同一套编辑器状态（绝不另造并行导演台）；本文件是纯函数层——
// 任务词汇、CTA 文案、全局状态句推导，配单测。
export type Scene3DTaskMode = 'compose' | 'act' | 'move'

export const SCENE3D_TASK_ORDER: Scene3DTaskMode[] = ['compose', 'act', 'move']

export const SCENE3D_TASK_LABEL: Record<Scene3DTaskMode, string> = {
  compose: '摆一张构图图',
  act: '录一段人物动作',
  move: '做一段运镜参考',
}

export const SCENE3D_TASK_SHORT_LABEL: Record<Scene3DTaskMode, string> = {
  compose: '构图图',
  act: '人物动作',
  move: '运镜参考',
}

// CTA 随任务与录制态变：act 任务在录制中变成「完成这段动作」。
export function scene3dTaskCta(task: Scene3DTaskMode, recording: boolean): string {
  if (task === 'act') return recording ? '完成这段动作' : '开始录制'
  return task === 'compose' ? '使用这张构图' : '生成参考视频'
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
    const owner = input.possessedName || input.possessedCameraName || '场景'
    return `正在录制：${owner} · 键盘归${input.possessedCameraName && !input.possessedName ? '镜头' : '角色'}`
  }
  if (input.countdownRemaining !== null) return `${input.countdownRemaining} 秒后开录——就位`
  if (input.possessedName) return `正在操控：${input.possessedName}（WASD 走位 · C 蹲 · Space 跳）`
  if (input.possessedCameraName) return `正在操控镜头：${input.possessedCameraName}（WASD 飞行取景）`
  if (input.cameraViewEditName) return `正在取景：${input.cameraViewEditName} · 这就是最终画面`
  if (input.isPlaying) return '正在预览最终镜头'
  if (input.trajectoryMode) return '正在编辑轨迹（点空白处新建点）'
  if (input.selectionName) {
    return input.selectionKind === 'camera'
      ? `已选中镜头：${input.selectionName}`
      : `正在移动：${input.selectionName}`
  }
  return '点左侧或画面里的对象开始'
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
    return { label: `${cameraViewEditName}${cameraAspect ? ` · ${cameraAspect}` : ''} · 输出画面`, isOutput: true }
  }
  return { label: '工作视图 · 不会出片', isOutput: false }
}
