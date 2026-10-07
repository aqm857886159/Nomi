import type { TFunction } from 'i18next'
import type { WorkbenchMenuIcon, WorkbenchMenuNode } from '../../../design/menu'
import type { ConnectionCreateVerdict } from '../agent/referenceEdgeCapability'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getGenerationNodeIcon } from '../nodes/renderRegistry'

/**
 * 「用这个节点生成…」菜单的项（纯投影）。判据是 `connectionCreateVerdictsForSource(s)`（拖线松手与点「+」同一份）；
 * 这里只把「能 / 不能 + 原因」翻成菜单项。组件在 `NodeDeriveMenu.tsx`。
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

const ASSET_LABEL_KEYS = {
  image: 'generationCommon.quickActions.derive.assets.image',
  video: 'generationCommon.quickActions.derive.assets.video',
  audio: 'generationCommon.quickActions.derive.assets.audio',
} as const

function blockedReason(verdict: ConnectionCreateVerdict<NodeDeriveKind>, t: TFunction): string | undefined {
  if (verdict.ok) return undefined
  if (verdict.reason === 'source_not_referenceable' || !verdict.asset) {
    return t('generationCommon.quickActions.derive.sourceNotReferenceable')
  }
  return t('generationCommon.quickActions.derive.noModelAccepts', {
    asset: t(ASSET_LABEL_KEYS[verdict.asset]),
    kind: t(KIND_LABEL_KEYS[verdict.kind]),
  })
}

/** 菜单项（纯投影，给实验室与将来的宿主共用）。 */
export function buildNodeDeriveMenuItems(
  verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[],
  t: TFunction,
  onPick: (kind: NodeDeriveKind) => void,
): WorkbenchMenuNode[] {
  return [{
    kind: 'group',
    id: 'derive',
    label: t('generationCommon.quickActions.derive.title'),
    items: verdicts.map((verdict) => {
      const reason = blockedReason(verdict, t)
      return {
        id: `derive-${verdict.kind}`,
        label: t(KIND_LABEL_KEYS[verdict.kind]),
        icon: getGenerationNodeIcon(verdict.kind) as unknown as WorkbenchMenuIcon,
        disabled: !verdict.ok,
        // 原因写在第二行（看得见），同时挂 title（读屏 / 悬停）：灰掉的项光靠悬停才说原因 = 没说。
        ...(reason ? { description: reason, disabledReason: reason } : {}),
        onSelect: () => onPick(verdict.kind),
      }
    }),
  }]
}
