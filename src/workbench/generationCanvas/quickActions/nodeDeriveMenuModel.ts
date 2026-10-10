import type { TFunction } from 'i18next'
import { IconFolderOpen, IconPointer } from '../../../vendor/tablerIcons'
import type { WorkbenchMenuIcon, WorkbenchMenuNode } from '../../../design/menu'
import type { ConnectionCreateVerdict } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasNode, GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeIcon } from '../nodes/renderRegistry'

/**
 * 两个拉环菜单的项（纯投影）：右「+」=「用这个节点生成」（判据 `connectionCreateVerdictsForSource(s)`），
 * 左「+」=「给它加输入」（判据 `connectionCreateVerdictsForTarget`）。拖线松手与点「+」同一份判据；
 * 两侧同一个 WorkbenchMenu 原语、同一套置灰 + 第二行原因（下面 `blockedReason` 一处翻译）。组件在 `NodeDeriveMenu.tsx`。
 */

/** 候选全集，顺序即菜单顺序（与左缘加号同序：图片 / 视频 / 声音 / 文字）。 */
export const NODE_DERIVE_KINDS = ['image', 'video', 'audio', 'text'] as const satisfies readonly GenerationNodeKind[]
export type NodeDeriveKind = (typeof NODE_DERIVE_KINDS)[number]

const KIND_LABEL_KEYS = {
  image: 'canvas.nodeKinds.image',
  video: 'canvas.nodeKinds.video',
  audio: 'canvas.nodeKinds.audio',
  text: 'canvas.nodeKinds.text',
} as const satisfies Record<NodeDeriveKind, string>

/** 原因里出现的「目标」种类名：有左环的种类里，菜单会问到的那几类。其余种类走「节点」兜底（不会出现：没有左环就没有左菜单）。 */
const TARGET_LABEL_KEYS: Partial<Record<GenerationNodeKind, string>> = {
  ...KIND_LABEL_KEYS,
  clip: 'canvas.nodeKinds.clip',
  model3d: 'canvas.nodeKinds.model3d',
  director: 'canvas.nodeKinds.director',
}

const ASSET_LABEL_KEYS = {
  image: 'generationCommon.quickActions.derive.assets.image',
  video: 'generationCommon.quickActions.derive.assets.video',
  audio: 'generationCommon.quickActions.derive.assets.audio',
} as const

function blockedReason(verdict: ConnectionCreateVerdict<NodeDeriveKind>, t: TFunction, target?: Pick<GenerationCanvasNode, 'kind'>): string | undefined {
  if (verdict.ok) return undefined
  // 左「+」：这一类根本不收这种输入（剪辑卡不收文字）/ 这张卡当前选的模型不收这种素材。
  if (verdict.reason === 'not_accepted' && target) {
    const targetKey = TARGET_LABEL_KEYS[target.kind]
    return t('generationCommon.quickActions.addInput.notAccepted', {
      target: targetKey ? t(targetKey) : t('generationCommon.card.node'),
      source: t(KIND_LABEL_KEYS[verdict.kind]),
    })
  }
  if (verdict.reason === 'model_rejects' && verdict.asset) {
    return t('generationCommon.quickActions.addInput.modelRejects', { asset: t(ASSET_LABEL_KEYS[verdict.asset]) })
  }
  if (verdict.reason === 'source_not_referenceable' || !verdict.asset) {
    return t('generationCommon.quickActions.derive.sourceNotReferenceable')
  }
  // 右「+」问的是「新建的这一类」有没有模型收；左「+」问的是「本卡这一类」有没有模型收。
  const kindKey = target ? TARGET_LABEL_KEYS[target.kind] : KIND_LABEL_KEYS[verdict.kind]
  return t('generationCommon.quickActions.derive.noModelAccepts', {
    asset: t(ASSET_LABEL_KEYS[verdict.asset]),
    kind: kindKey ? t(kindKey) : t('generationCommon.card.node'),
  })
}

/** 一类一项：同序、同图标；接不上的灰掉，原因写在第二行（看得见），同时挂 title（读屏 / 悬停）。 */
function kindItems(
  prefix: string,
  verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[],
  t: TFunction,
  onPick: (kind: NodeDeriveKind) => void,
  target?: Pick<GenerationCanvasNode, 'kind'>,
): WorkbenchMenuNode[] {
  return verdicts.map((verdict) => {
    const reason = blockedReason(verdict, t, target)
    return {
      id: `${prefix}-${verdict.kind}`,
      label: t(KIND_LABEL_KEYS[verdict.kind]),
      icon: getGenerationNodeIcon(verdict.kind) as unknown as WorkbenchMenuIcon,
      disabled: !verdict.ok,
      // 灰掉的项光靠悬停才说原因 = 没说。
      ...(reason ? { description: reason, disabledReason: reason } : {}),
      onSelect: () => onPick(verdict.kind),
    }
  })
}

/** 右「+」「用这个节点生成」的项。 */
export function buildNodeDeriveMenuItems(
  verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[],
  t: TFunction,
  onPick: (kind: NodeDeriveKind) => void,
): WorkbenchMenuNode[] {
  return [{ kind: 'group', id: 'derive', label: t('generationCommon.quickActions.derive.title'), items: kindItems('derive', verdicts, t, onPick) }]
}

/**
 * 左「+」「给它加输入」的项：四类（判据以本卡为目标）、一条分隔线、「从素材库添加…」「在画布上点选」。
 * 素材库一项：本卡一类素材都收不下时灰掉（原因同第一类灰项）。
 */
export function buildNodeAddInputMenuItems(
  verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[],
  target: Pick<GenerationCanvasNode, 'kind'>,
  t: TFunction,
  handlers: { onPick: (kind: NodeDeriveKind) => void; onFromAssets: () => void; onPickOnCanvas: () => void },
): WorkbenchMenuNode[] {
  const takesMedia = verdicts.some((verdict) => verdict.ok && verdict.kind !== 'text')
  const mediaReason = takesMedia ? undefined : blockedReason(verdicts.find((verdict) => verdict.kind !== 'text' && !verdict.ok) ?? verdicts[0], t, target)
  return [
    { kind: 'group', id: 'add-input', label: t('generationCommon.quickActions.addInput.title'), items: kindItems('add-input', verdicts, t, handlers.onPick, target) },
    { kind: 'separator', id: 'add-input-sep' },
    {
      id: 'add-input-assets',
      label: t('generationCommon.quickActions.addInput.fromAssets'),
      icon: IconFolderOpen as unknown as WorkbenchMenuIcon,
      disabled: !takesMedia,
      ...(mediaReason ? { description: mediaReason, disabledReason: mediaReason } : {}),
      onSelect: handlers.onFromAssets,
    },
    { id: 'add-input-pick', label: t('generationCommon.quickActions.addInput.pickOnCanvas'), icon: IconPointer as unknown as WorkbenchMenuIcon, onSelect: handlers.onPickOnCanvas },
  ]
}

/** 左「+」素材选择器收哪几种素材：判据里能接的媒体类。 */
export function addInputAcceptedAssets(verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[]): ('image' | 'video' | 'audio')[] {
  return verdicts.flatMap((verdict) => (verdict.ok && verdict.kind !== 'text' ? [verdict.kind] : []))
}
