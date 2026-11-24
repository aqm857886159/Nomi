// 视频比例的产品默认（用户 2026-07-17 拍板：首选 16:9，已连输入**全竖**才 9:16）——**唯一出处**。
//
// 为什么收到这里（2026-10-22，R-d2-defaults #1）：这条默认以前有两个 owner——选模型时铺一次
// （buildNodeModelChangePatch），生成框挂载时再按它「纠正」一次（NodeParameterControls 的 effect）。
// 后者不认 Agent 写的值：Agent 写 9:16，节点一点开就被改成 16:9，之后在节点上点生成发的就是 16:9。
// 「打开节点」不是用户改参数的手势，数据不该因为它变。现在只有三个手势会铺这条默认：
//   ① 选模型（buildNodeModelChangePatch）——换模型本来就重铺全部默认值；
//   ② 新卡自动选模型（useNodeModelAutoSelect）——用户手建的卡第一次拿到模型；
//   ③ 连线（store/canvasConnectDerivations，单连 / 组连线 / Agent 计划连线 / 3D 站位连线共用）——
//      只改**没被明确选过**比例的视频节点（用户 2026-10-22 Q2 拍板）；断线、删上游不回头改；
//   ④ 切方式（NodeParameterControls.handleModeSwitch）——未明确选过比例时按目标方式重算（视频编辑默认跟随原视频 auto，
//      参考 / 文生维持 07-17 的 16:9 / 9:16 规则）。
// 「明确选过」只有一个标记 `aspect_ratio_user_set`：用户在比例控件上选、或落地时 Agent / 分镜写了合法比例。
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ModelOption } from '../../../config/models'
import { collectInputAspectRatios, nodeAspectRatioValue, preferredVideoAspect } from './aspectRatio'
import { isAspectRatioControl, videoAspectDefaultPatch, type DynamicModelControl } from './controls/parameterControlModel'
import { resolveRenderedControls, resolveRenderedMode } from './nodeModelArchetype'
import { ASPECT_RATIO_META_KEYS, isAutoOptionValue, normalizeAspectRatioToWH, sameAspectRatio } from '../../../../electron/shared/aspectRatioValue'
import { readMediaDimensions } from './nodeSizing'
import { ASPECT_EXPLICIT_META_KEY } from './aspectExplicit'

export type VideoAspectSeedInput = {
  nodeId: string
  /** 这次手势之后的画布（连线手势：边已经建上）。 */
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  /** 这个节点此刻（或即将换上的模型）的参数控件。 */
  controls: readonly DynamicModelControl[]
  /** 节点当前 meta（换模型时是换之前的；用来判「明确选过」与「已经是首选」）。 */
  meta: Record<string, unknown>
  /** 当前或即将生效的档案方式（视频编辑 intent=edit 且控件默认 auto 时不套用 16:9/9:16 覆盖）。 */
  mode?: { intent?: string } | null
  /**
   * 明确选过的比例要不要让：连线 / 切方式让（Q2），选模型 / 新卡不让（换模型本来就重铺全部默认值，新卡没有可让的）。
   */
  respectExplicit: boolean
}

/**
 * 节点此刻的比例是不是已经是首选：按 ASPECT_RATIO_META_KEYS 的优先级取第一个读得出比例的键（aspect_ratio 最先），
 * 再约分比较（`720:1280` 就是 9:16）。只看这一个键——旧模式残留在别的键上的比例不算数，不能挡住该铺的默认值。
 */
function hasCurrentAspect(meta: Record<string, unknown>, preferred: string): boolean {
  for (const key of ASPECT_RATIO_META_KEYS) {
    const value = String(meta[key] ?? '')
    if (normalizeAspectRatioToWH(value)) return sameAspectRatio(value, preferred)
  }
  return false
}

/**
 * 视频编辑方式（intent=edit）且比例控件声明默认自动（auto / adaptive = 跟随原视频）：
 * 让位给档案自己的默认，清掉机器此前铺的 16:9 / 9:16（不写成字面 'auto'，删掉输入退回文生时也不会残留非法 'auto'）。
 */
function editModeAutoAspectClearPatch(input: VideoAspectSeedInput): Record<string, unknown> | null {
  if (input.mode?.intent !== 'edit') return null
  for (const control of input.controls) {
    if (!isAspectRatioControl(control)) continue
    if (control.defaultValue === undefined || !isAutoOptionValue(String(control.defaultValue))) return null
    const keys = control.key === 'aspect_ratio' ? [control.key] : [control.key, 'aspect_ratio']
    const alreadyUnsetOrAuto = keys.every((key) => {
      const value = input.meta[key]
      return value === undefined || isAutoOptionValue(String(value))
    })
    if (input.respectExplicit && alreadyUnsetOrAuto) return {}
    const patch: Record<string, unknown> = {}
    for (const key of keys) patch[key] = undefined
    return patch
  }
  return null
}

/** 把 videoAspectSeedPatch 合并进 meta；值为 undefined 的键显式删除，避免留空属性。 */
export function applyVideoAspectSeed(meta: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(patch)
  if (entries.length === 0) return meta
  const next: Record<string, unknown> = { ...meta }
  for (const [key, value] of entries) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

/** 铺视频比例默认值的那一笔 meta patch；不该改（明确选过 / 已经是首选 / 模型没有对应档）→ 空对象。 */
export function videoAspectSeedPatch(input: VideoAspectSeedInput): Record<string, unknown> {
  if (input.respectExplicit && input.meta[ASPECT_EXPLICIT_META_KEY] === true) return {}
  const editClear = editModeAutoAspectClearPatch(input)
  if (editClear !== null) return editClear
  const firstFrame = input.edges.find(edge => edge.target === input.nodeId && edge.mode === 'first_frame')
  const source = firstFrame && input.nodes.find(node => node.id === firstFrame.source)
  if (source && (source.kind === 'image' || source.result?.type === 'image')) {
    const pixels = source.result?.type === 'image' && readMediaDimensions(source.meta?.imageWidth, source.meta?.imageHeight)
    const frameRatio = pixels ? `${pixels.width}:${pixels.height}` : nodeAspectRatioValue(source)
    for (const preferred of ['auto', frameRatio]) {
      if (!preferred) continue
      const patch = videoAspectDefaultPatch(input.controls, preferred)
      if (!Object.keys(patch).length) continue
      if (input.respectExplicit && (hasCurrentAspect(input.meta, preferred) ||
        Object.entries(patch).every(([key, value]) => input.meta[key] === value))) return {}
      return patch
    }
  }
  const preferred = preferredVideoAspect(collectInputAspectRatios(input.nodeId, input.edges, input.nodes))
  if (input.respectExplicit && hasCurrentAspect(input.meta, preferred)) return {}
  return videoAspectDefaultPatch(input.controls, preferred)
}

/** 切视频生成方式后按新方式重铺未明确选过的比例默认（编辑方式让位给 auto，参考/文生维持 16:9/9:16）。 */
export function seedVideoAspectForModeSwitch(input: {
  node: GenerationCanvasNode
  nextMeta: Record<string, unknown>
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
  option: ModelOption | null
  isImageLike: boolean
}): Record<string, unknown> {
  const nextNode = { ...input.node, meta: input.nextMeta }
  const nextNodes = input.nodes.map((item) => (item.id === input.node.id ? nextNode : item))
  const nextGraph = { nodes: nextNodes, edges: input.edges }
  const mode = resolveRenderedMode(input.option, input.nextMeta, true, { node: nextNode, graph: nextGraph })
  const controls = resolveRenderedControls(input.option, input.nextMeta, input.isImageLike, true, { node: nextNode, graph: nextGraph })
  const patch = videoAspectSeedPatch({
    nodeId: input.node.id,
    nodes: nextNodes,
    edges: input.edges,
    controls,
    meta: input.nextMeta,
    mode,
    respectExplicit: true,
  })
  return applyVideoAspectSeed(input.nextMeta, patch)
}
