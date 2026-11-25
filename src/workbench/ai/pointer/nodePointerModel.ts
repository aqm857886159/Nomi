// 指向元素读节点的那一层（NodePointer 板，2026-10-23 D2）：一个指向元素要的全部事实、画面框比例的算式、按脸取的框底色。
// 指向元素自己（NodePointer）和组里的格子（NodePointerGroup）都读这一份。这里只放事实与算式、不放组件：
// 组件文件只导出组件，热更新才不失效（react-refresh/only-export-components）。
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { selectCanvasNodeById } from '../../generationCanvas/store/canvasNodeGenerationIndex'
import {
  productionShotCornerText,
  stoppedCopyOf,
  useProductionShotState,
} from '../../generationCanvas/nodes/productionShotCorner'
import { useGenerationFeedback } from '../../observability/useGenerationFeedback'
import {
  formatStoryboardShotLabel,
  isAutoStoryboardShotTitle,
  useStoryboardShotLabel,
} from '../../generation/list/storyboardLabels'
import { useModelLabels } from '../../generation/list/generationListModelLabels'
import {
  isPortraitAspect,
  nodePointerAspect,
  nodePointerFace,
  nodePointerSummary,
  nodePointerSummaryFacts,
  type NodePointerFace,
} from './nodePointerFace'

export type NodePointerSubject = Readonly<{
  nodeId: string
  /** 宿主手里的名字快照：节点不在画布上时（已删除 / 占位）靠它说是哪一镜。 */
  fallbackLabel?: Readonly<{ shot?: string; title?: string }>
  /** 宿主给的显式事实：这个节点被删了（删除事件 / 制作脱离记录）。不给就不说「已删除」（板 D4）。 */
  removed?: boolean
  /** 宿主给的这一镜结局（例如付费卡的「没有发出去」）。失败时印在摘要行；不给就照常印模型摘要。 */
  outcome?: string
  /**
   * 宿主给的显式事实：这一镜这一次没成（付费卡交给画布却没发出去 / 参数被拒），值是状态条上那一个词。
   * 节点自己没有失败记录时也画失败脸（见 nodePointerFace）；不给就只读节点。
   */
  hostFailure?: string
  /** 宿主在当前一次出价里给这一格的状态词（例如失败态的「还没发」）。 */
  hostStatus?: string
  /**
   * 只对列表行、且组说「第二行只写有话要说的」（`rowDetail="status"`）时：这一镜和兄弟不一样的那一句（付费确认：
   * 这一镜的参数和这一批的共同值不同，「9:16 · 5s」）。节点自己有状态 / 失败时让给状态。
   */
  note?: string
}>

export type NodePointerDensity = 'card' | 'row' | 'chip'

export type Translate = ReturnType<typeof useTranslation>['t']

/** 组里一格的画面槽固定 16:9（宽的贴满宽、竖的贴满高并居中）。 */
export const SLOT_ASPECT = 16 / 9

export type PointerModel = {
  node: GenerationCanvasNode | undefined
  face: NodePointerFace
  /** 读屏 / 悬停提示用的名字：镜号 + 标题。 */
  name: string
  shotText: string | null
  title: string
  status: string | null
  hostStatus?: string
  summary: (form: 'card' | 'row' | 'side') => readonly string[]
  aspect: number
  portrait: boolean
}

/** 读一个指向元素要的全部事实：只订这一个节点（selectCanvasNodeById 走单次派生索引，对象不变就不重渲）。 */
export function usePointerModel(subject: NodePointerSubject): PointerModel {
  const { t } = useTranslation()
  const node = useGenerationCanvasStore((state) => selectCanvasNodeById(state, subject.nodeId))
  const canvasReady = useGenerationCanvasStore((state) => state.isReady)
  const feedback = useGenerationFeedback(node)
  const production = useProductionShotState(node)
  const modelLabel = useModelLabels()
  const shotLabel = useStoryboardShotLabel(node)
  const face = nodePointerFace({
    node,
    removed: subject.removed,
    canvasReady,
    feedback,
    productionState: production.state,
    ...(subject.hostFailure ? { hostFailure: subject.hostFailure } : {}),
  })
  const shotText = node
    ? shotLabel
      ? formatStoryboardShotLabel(t, shotLabel)
      : null
    : (subject.fallbackLabel?.shot ?? null)
  const rawTitle = node
    ? shotLabel && isAutoStoryboardShotTitle(node.title, shotLabel.number)
      ? ''
      : (node.title ?? '')
    : (subject.fallbackLabel?.title ?? '')
  const title = rawTitle.trim()
  const facts = nodePointerSummaryFacts(node, modelLabel(node))
  const aspectText = facts.aspect
  return {
    node,
    face,
    name: [shotText, title].filter(Boolean).join(' ') || t('nodePointer.untitled'),
    shotText,
    title,
    status: faceStatusText(t, face),
    ...(subject.hostStatus ? { hostStatus: subject.hostStatus } : {}),
    summary: (form) => nodePointerSummary(facts, form),
    aspect: aspectFromText(aspectText),
    portrait: isPortraitAspect(aspectText),
  }
}

function aspectSize(aspect: string): { width: number; height: number } {
  const [width, height] = aspect.split(':').map(Number)
  return { width, height }
}

/** 节点比例文字（「16:9」）→ 画面框的宽 / 高；读不出就按 16:9 槽。指向元素自己和组里挂了小动作的格子（PointerCell）读同一个算式。 */
export function aspectFromText(aspect: string | null): number {
  return aspect ? nodePointerAspect(aspectSize(aspect)) : SLOT_ASPECT
}

/** 画面框占 16:9 槽宽的百分之几：横版满宽，竖 / 窄版按真比例。框自己的位置（frameBox）与挂在框右上角的小动作（PointerCell）都读这一份。 */
export function frameWidthPercent(aspect: number): number {
  return Math.min(100, (aspect / SLOT_ASPECT) * 100)
}

/** 读屏和悬停提示里的「状态」：都是节点自己那几句（制作小标 / 状态条原话 / 可找回 / 已停原因）。 */
function faceStatusText(t: Translate, face: NodePointerFace): string | null {
  switch (face.kind) {
    case 'removed':
      return t('nodePointer.deleted')
    case 'generating':
    case 'failed':
      return face.feedback.message
    case 'recoverable':
      return t('shotTable.status.recoverable')
    case 'production':
      return productionShotCornerText(t, face.state)?.text ?? null
    case 'stopped':
      return t(stoppedCopyOf(face.state.stoppedReason).message)
    default:
      return null
  }
}

/** 画面框的底色随脸走：失败不用粉底（板）；已停用节点同一个 warning 淡底；其余纸白 / ink-05。 */
export function frameTone(face: NodePointerFace): string {
  if (face.kind === 'result' || face.kind === 'generating' || face.kind === 'processing') return 'bg-nomi-ink-05'
  if (face.kind === 'stopped') return 'bg-[color-mix(in_oklab,var(--nomi-warning)_6%,var(--nomi-paper))]'
  return 'bg-nomi-paper'
}
