/**
 * [INPUT]: 依赖 electron/shared/agentContextSnapshot 的 AgentContextHandle 类型
 * [OUTPUT]: 对外提供 DirectorShotFocus、shotIdOfCamera、nextShotSelection（镜头条点卡 / 加选）、directorShotFocusFrom（编辑器选择 → 选中的计划镜头）、
 *           directorShotContextHandles（镜头焦点 → 常驻输入框发送时附带的上下文）、DIRECTOR_SHOT_LOCATOR_KEY
 * [POS]: 3D-BOX「正在改：镜头 N」的数据通路（方案 §7 第 5 条）。焦点的 owner 是编辑器 store 的 selection；
 *        这里只把它投影成「哪个导演节点、哪一版计划、哪几镜（计划里的名字 + 镜头条上的序号）」，不存第二份。
 *        只认编译器的稳定机位 id `shot:<名>/camera` 且名字在当前计划里的机位；用户自建机位不算计划镜头，不带。
 *        发给模型的是 canvasNode 句柄 + custom 定位器（值 = 镜头名），模型据此按名字补丁，模型面一个字不加。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AgentContextHandle } from '../../../../../../electron/shared/agentContextSnapshot'
import type { DirectorShotSummary } from './directorShotSummaries'

export const DIRECTOR_SHOT_LOCATOR_KEY = 'director.shot'

export type DirectorShotFocus = Readonly<{
  directorNodeId: string
  /** 当前计划修订号（Agent 补丁的 baseRevision）；节点没有 3D-BOX 计划 = null，此时不产生焦点。 */
  revision: string
  /** 镜头名 + 镜头条序号 + 这一镜的实测（标签上「· 中近景 · 固定」那段；没进切点 = 没有实测）。 */
  shots: readonly Readonly<{ shotId: string; index: number; measured: Pick<DirectorShotSummary, 'shotSize' | 'move' | 'start' | 'end' | 'cameraId' | 'actions'> | null }>[]
}>

const CAMERA_ID = /^shot:(.+)\/camera$/

export function shotIdOfCamera(cameraId: string | null | undefined): string | null {
  return cameraId?.match(CAMERA_ID)?.[1] ?? null
}

/**
 * 编辑器里选中的机位 → 计划镜头。序号 = 镜头条上的位置（实测切点顺序，和用户眼睛看到的「镜头 N」一致）；
 * 这台机位没进切点（时长被手调成 0 之类）就退到计划里的顺序。
 */
export function directorShotFocusFrom(input: Readonly<{
  directorNodeId: string
  revision: string | null
  planShotIds: readonly string[]
  cuts: readonly DirectorShotSummary[]
  selectedCameraIds: readonly (string | null)[]
}>): DirectorShotFocus | null {
  if (!input.revision) return null
  const shots: { shotId: string; index: number; measured: DirectorShotSummary | null }[] = []
  for (const cameraId of input.selectedCameraIds) {
    const shotId = shotIdOfCamera(cameraId)
    if (!shotId || !input.planShotIds.includes(shotId) || shots.some((shot) => shot.shotId === shotId)) continue
    const cut = input.cuts.findIndex((item) => item.cameraId === cameraId)
    shots.push({ shotId, index: (cut >= 0 ? cut : input.planShotIds.indexOf(shotId)) + 1, measured: cut >= 0 ? input.cuts[cut] : null })
  }
  if (!shots.length) return null
  return { directorNodeId: input.directorNodeId, revision: input.revision, shots: shots.sort((a, b) => a.index - b.index) }
}

/**
 * 镜头条点卡后的选中（画布「3D-BOX · 正在改：镜头 N」）：普通点 = 只选这一镜；Ctrl / Shift / ⌘ 点 = 加选或取消这一镜。
 * 返回新的机位 id 列表（第一个是主选）。
 */
export function nextShotSelection(current: readonly string[], cameraId: string, additive: boolean): string[] {
  if (!additive) return [cameraId]
  return current.includes(cameraId) ? current.filter((id) => id !== cameraId) : [...current, cameraId]
}

/** 一镜一条句柄：同一个导演节点、同一版修订，定位器的值是计划里的镜头名（补丁路径 /shots/<名>/…）。 */
export function directorShotContextHandles(focus: DirectorShotFocus | null, title: (index: number) => string, subtitle: string): AgentContextHandle[] {
  if (!focus) return []
  return focus.shots.map((shot) => ({
    id: `director-shot:${focus.directorNodeId}/${shot.shotId}`,
    kind: 'canvasNode',
    targetId: focus.directorNodeId,
    revision: focus.revision,
    locator: { type: 'custom', key: DIRECTOR_SHOT_LOCATOR_KEY, value: shot.shotId },
    display: { title: title(shot.index), subtitle },
    intentRole: 'target',
  }))
}
