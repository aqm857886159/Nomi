// 指向元素此刻画哪一张脸、摘要那一行写什么（纯函数，可裸测）。
//
// 一个东西一个家（设计系统 §1.0）：指向元素不存节点的状态，也不另写一套「状态 → 样子」的判断。
// 它读的是画布节点自己读的那几份事实，判序照 BaseGenerationNode 叠层的先后：
//   ① 节点不在画布上（或画布还没载入完）：宿主显式说了删 → 已删除（只在指向元素上有）；没说 → 中性占位。
//      不靠「找不到就猜」：载入中、撤销回放的那一瞬节点也会不在（NodePointer 板 D4，协调 10-23 代定）。
//   ② 导入中 / 本机处理中                      → 等待面（节点上是 NodeImportingOverlay / GeneratingOverlay）
//   ③ 生成反馈在跑（排队 / 生成中）            → 等待面 + 状态条（GenerationWaitingSurface + GenerationStatusBar）
//   ④ 生成反馈是失败                           → 状态条红点 + 节点自己的那句原因
//   ⑤ 可找回（已提交、没取回）                 → 中性「可找回」（节点上是 NodeRecoverableReport）
//   ⑥ 有结果画面                               → 结果缩略图（画布轻量档同一个取图函数）
//   ⑦ 制作流程还没开拍这一镜（节点上有左上小标的那几段）→ 空卡 + 同一枚小标（判据 hasProductionShotCorner）
//   ⑧ 制作流程停在这一镜                       → 节点上同一句停下原因（详细入口在节点上，聊天里不放动作）
//   ⑨ 其余                                     → 空卡（NodeEmptyState 的圆托 + 种类图标）
import type { GenerationFeedback } from '../../observability/generationFeedback'
import { resolveLightweightNodePreview, type LightweightNodePreview } from '../../generationCanvas/components/canvasNodeLevelOfDetail'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { isLocalProcessingProgressPhase } from '../../generationCanvas/model/localProcessingPhase'
import type { ProductionShotState } from '../../../../electron/shared/productionShotPhase'
import { hasProductionShotCorner } from '../../generationCanvas/nodes/productionShotCorner'
import { getGenerationNodeExecutionKind } from '../../generationCanvas/model/generationNodeKinds'
import { formatSeconds, readDurationSeconds } from '../../generation/list/generationListMediaFacts'
import { ASPECT_RATIO_META_KEYS, readAspectRatioGeometry } from '../../../../electron/shared/aspectRatioValue'

export type NodePointerFace =
  | Readonly<{ kind: 'removed' }>
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'processing' }>
  | Readonly<{ kind: 'generating'; feedback: GenerationFeedback }>
  | Readonly<{ kind: 'failed'; feedback: GenerationFeedback }>
  | Readonly<{ kind: 'recoverable' }>
  | Readonly<{ kind: 'result'; preview: LightweightNodePreview }>
  | Readonly<{ kind: 'production'; state: ProductionShotState }>
  | Readonly<{ kind: 'stopped'; state: Extract<ProductionShotState, { phase: 'stopped' }> }>
  | Readonly<{ kind: 'empty' }>

export type NodePointerFaceKind = NodePointerFace['kind']

export function nodePointerFace(input: Readonly<{
  node: GenerationCanvasNode | undefined
  /** 宿主给的显式事实：这个节点被删了（删除事件 / 制作脱离记录）。节点还在画布上时以节点为准（撤销回来了）。 */
  removed?: boolean
  /** 画布内容载入完了没有（`useGenerationCanvasStore.isReady`）。没载入完，节点不在不代表被删。 */
  canvasReady: boolean
  feedback: GenerationFeedback | null | undefined
  /** 这一镜在制作流程里的阶段（节点不归制作流程管时缺席）。 */
  productionState?: ProductionShotState | null
  /**
   * 宿主给的显式事实：这一镜这一次没成（付费卡：交给画布却没发出去 / 参数被拒），值是状态条上那一个词。
   * 节点自己可能一笔失败记录都没有（同意在派发前就收回了），所以由宿主说；节点自己在跑 / 自己失败时以节点为准。
   */
  hostFailure?: string
}>): NodePointerFace {
  const { node, removed = false, canvasReady, feedback, productionState, hostFailure } = input
  if (!node || !canvasReady) return removed ? { kind: 'removed' } : { kind: 'unavailable' }
  if (node.meta?.uploadStatus === 'uploading' || isLocalProcessingProgressPhase(node.progress?.phase)) return { kind: 'processing' }
  if (feedback?.active) return { kind: 'generating', feedback }
  if (feedback?.phase === 'failed') return { kind: 'failed', feedback }
  if (hostFailure) return { kind: 'failed', feedback: { phase: 'failed', message: hostFailure, late: false, active: false, previewLabel: '' } }
  if (node.status === 'recoverable') return { kind: 'recoverable' }
  const preview = resolveLightweightNodePreview(node)
  if (preview) return { kind: 'result', preview }
  if (productionState && hasProductionShotCorner(productionState)) return { kind: 'production', state: productionState }
  if (productionState?.phase === 'stopped') return { kind: 'stopped', state: productionState }
  return { kind: 'empty' }
}

/** 能不能点：已删除与占位不可点（没有目标可去）；其余一律点了去节点。 */
export function nodePointerLocatable(face: NodePointerFace): boolean {
  return face.kind !== 'removed' && face.kind !== 'unavailable'
}

/** 缩略图正中可能放的四样，按先后排（先的压后的）。 */
export type PointerCenterTier = 'restore' | 'located' | 'status' | 'icon'
const POINTER_CENTER_ORDER: readonly PointerCenterTier[] = ['restore', 'located', 'status', 'icon']

/**
 * 缩略图正中只放一样东西（SpendCardQ1 板 card.pointer.status / card.pointer.exclude）：按「恢复 > 已定位 > 状态胶囊 > 种类图标」取第一个。
 * 铺满整格的（结果图、等待面）和贴角的小标不算正中件，另画。「恢复」是宿主挂在格子上的常驻小动作、不是这一格自己画的：
 * 组把「正中已被占」告诉这一格（`restore`），这一格的三样就一样都不画。谁占正中只在这一处判——不按状态逐个开分支。
 */
export function pointerCenterTier(has: Readonly<Record<PointerCenterTier, boolean>>): PointerCenterTier | null {
  return POINTER_CENTER_ORDER.find((tier) => has[tier]) ?? null
}

/** 指向元素里节点画面的比例（宽 / 高）。竖版按真比例放进固定高度的槽里，不裁不拉伸。 */
export function nodePointerAspect(size: Readonly<{ width: number; height: number }>): number {
  const ratio = size.width / size.height
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9
}

/**
 * 组指向露几个（NodePointer 板 `pointer.group.more`，协调 10-23 定按板图读）：
 * 超过 `max` 个就露 `max` 格，最后一格（仍是那一镜的标题行）的画面位置盖「还有 N 个」，N = 总数 − max；展开了就全露。
 * 4 个也折（板：超过 3 个就折）。
 */
export function nodePointerGroupVisible(total: number, max: number, expanded: boolean): Readonly<{ shown: number; hidden: number }> {
  if (expanded || total <= max) return { shown: total, hidden: 0 }
  return { shown: max, hidden: total - max }
}

/**
 * 组里被悬停 / 聚焦的是哪一格（纯函数）：先后到的排成一摞，离开的只拿掉自己，亮最后到的那一格。
 * 只存一个「当前是谁」的话，后到者一走就会把先到者还指着的清掉——和画布高亮的认领（nodeExternalHighlightStore）同一类错。
 * 摘要行只需要这一摞的最后一个 nodeId，摘要本身每次渲染从节点现算（不存）。
 */
export function pointerHoverStack(stack: readonly string[], nodeId: string, hovering: boolean): readonly string[] {
  if (hovering) return stack[stack.length - 1] === nodeId ? stack : [...stack.filter((id) => id !== nodeId), nodeId]
  return stack.includes(nodeId) ? stack.filter((id) => id !== nodeId) : stack
}

/** 标题里算「词」边界的那几个分隔符：空白、间隔号、下划线、连字符、冒号、逗号、顿号、斜线、竖线、括号。 */
const TITLE_SEPARATOR = /[\s·・_\-–—:：,，、/|()（）[\]【】]/u
/** 往回找词头最多退几个字；再远就当没有词边界（中文标题常常一个空格都没有）。 */
const TITLE_WORD_REACH = 6
/** 找不到词边界时尾巴往前多带几个字（「流第一幕」比「一幕」读得懂）。 */
const TITLE_CONTEXT = 2
/** 尾巴那个词短到这个数（「1」「02」）就把前一个词也带上（「纸船 1」）。 */
const TITLE_SHORT_WORD = 2

/**
 * 组里几格的标题共用一长截开头时（「S_NARROW_1 纸船 1 / 2 / 3」），窄格子照常从尾巴截，几格会被截成同一个样子、分不出是哪一镜
 * （真 App 窄窗走查 2026-10-25，用户圈出）。这里给每一格算出「和兄弟格不一样的那一截」从哪儿开始：标题行先截前面那截公共开头，
 * 这一截不截（截中间）。全名照旧在悬停提示和读屏名里。
 *
 * 每一格只和**离它最近的兄弟**比（公共开头最长的那一个）：三格里两格像、一格不像时，像的那两格各露自己的尾巴，不像的那一格不用分。
 * 尾巴从那个不一样的字所在的词开头起；词太短再带上前一个词；整句没有词边界就往前带两个字。返回码元下标（直接拿去 slice），
 * 0 = 不用分（没有兄弟、和谁都不共开头、或者整句就是别人的开头 / 和别人一字不差——那样怎么截都分不出）。
 */
export function nodePointerTitleTails(titles: readonly string[]): readonly number[] {
  const chars = titles.map((title) => Array.from(title))
  const separator = (char: string | undefined): boolean => char !== undefined && TITLE_SEPARATOR.test(char)
  return chars.map((own, index) => {
    let shared = 0
    chars.forEach((other, otherIndex) => {
      if (otherIndex === index) return
      let length = 0
      while (length < own.length && length < other.length && own[length] === other[length]) length += 1
      shared = Math.max(shared, length)
    })
    if (shared === 0 || shared >= own.length) return 0
    // 不一样的那个字所在的词从哪儿起：往回找分隔符，够不着（或一路退到开头都没有）就往前带两个字。
    let start = shared
    while (start > 0 && !separator(own[start - 1]) && shared - start < TITLE_WORD_REACH) start -= 1
    const atWordStart = start > 0 && separator(own[start - 1])
    if (!atWordStart) return own.slice(0, Math.max(0, shared - TITLE_CONTEXT)).join('').length
    // 那个词太短：把前一个词也带上（带到开头就算了——那等于不分）。
    let end = start
    while (end < own.length && !separator(own[end])) end += 1
    if (end - start <= TITLE_SHORT_WORD) {
      let previous = start
      while (previous > 0 && separator(own[previous - 1])) previous -= 1
      const wordEnd = previous
      while (previous > 0 && !separator(own[previous - 1]) && wordEnd - previous < TITLE_WORD_REACH) previous -= 1
      if (previous > 0 && previous < wordEnd) start = previous
    }
    return own.slice(0, start).join('').length
  })
}

/** 比例是不是竖的（「9:16」）。读不出就不是。 */
export function isPortraitAspect(aspect: string | null): boolean {
  const match = aspect ? /^(\d+):(\d+)$/.exec(aspect) : null
  return Boolean(match && Number(match[1]) < Number(match[2]))
}

/**
 * 摘要要的四样事实，从节点现读（指向元素自己的摘要行、组下方那一行、付费卡的合计摘要都读这一份）：
 * 模型显示名由调用方给（`useModelLabels`，目录异步），其余三样读节点 meta。不存、不缓存。
 */
export function nodePointerSummaryFacts(node: GenerationCanvasNode | undefined, modelLabel: string): NodePointerSummaryInput & Readonly<{ durationSec: number | null }> {
  const geometry = ASPECT_RATIO_META_KEYS.map(key => readAspectRatioGeometry(node?.meta?.[key])).find(size => size !== null)
  const aspect = geometry ? `${geometry.width}:${geometry.height}` : null
  const execution = node ? getGenerationNodeExecutionKind(node.kind) : undefined
  const durationSec = node && (execution === 'video' || execution === 'audio') ? readDurationSeconds(node) : null
  const resolution = typeof node?.meta?.resolution === 'string' ? node.meta.resolution : null
  return { model: modelLabel, aspect, duration: durationSec ? formatSeconds(durationSec) : null, resolution, durationSec: durationSec || null }
}

export type NodePointerSummaryInput = Readonly<{
  /** 节点上选好的模型显示名（`useModelLabels`，和生成框同一个判据；认不得就是空串）。 */
  model: string
  /** 节点的显示几何：比例与像素尺寸均按宽:高显示。 */
  aspect: string | null
  /** 已格式化的时长（`formatSeconds(readDurationSeconds)`；只有视频 / 音频有）。 */
  duration: string | null
  /** 清晰度（节点 meta.resolution，例如 480p）。 */
  resolution: string | null
}>

/**
 * 摘要那一行（只读，读节点；节点上没有这一行）。
 * - 卡（P1）：模型 · 比例 · 时长；
 * - 行（P2）：模型 · 时长，竖版必须带比例（比例是最容易看漏、又最会出错片的一项）；
 * - 单个竖版卡：摘要放画面右边分两行——模型 / 比例 · 时长 · 清晰度。
 * 什么都读不出就是空数组（不印空行）。
 */
export function nodePointerSummary(input: NodePointerSummaryInput, form: 'card' | 'row' | 'side'): readonly string[] {
  const portrait = isPortraitAspect(input.aspect)
  const join = (parts: ReadonlyArray<string | null | false>) => parts.filter((part): part is string => Boolean(part)).join(' · ')
  if (form === 'side') return [input.model, join([input.aspect, input.duration, input.resolution])].filter(Boolean)
  const line = form === 'row'
    ? join([input.model, portrait && input.aspect, input.duration])
    : join([input.model, input.aspect, input.duration])
  return line ? [line] : []
}
