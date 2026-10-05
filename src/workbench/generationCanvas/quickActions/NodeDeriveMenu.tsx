import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchMenu } from '../../../design/menu'
import type { ConnectionCreateVerdict } from '../agent/referenceEdgeCapability'
import { buildNodeDeriveMenuItems, type NodeDeriveKind } from './nodeDeriveMenuModel'

/**
 * 节点右侧「+」圈点一下：**用这个节点生成…**（2026-10-04 节点快捷动作批次 1）。
 *
 * 选一项 = 新建这一类空节点 + 连好线 + 选中它（不生成、不花钱）。点「+」圈和拖线到空白处松手出的是
 * 同一个菜单、同一份判据（`connectionCreateVerdictsForSource`）。
 *
 * **接不上的不藏，灰掉并在第二行说原因**（§1.6 C1 / C4：可点即有效，否则禁用并说明为什么）。
 * 藏起来的后果是用户以为「视频节点接不出图片」是 bug，或者以为是自己没找到。
 */

export function NodeDeriveMenu({
  verdicts,
  point,
  onPick,
  onClose,
}: {
  /** 每一类能不能接、为什么不能（`connectionCreateVerdictsForSource(s)`，NODE_DERIVE_KINDS 全集）。 */
  verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[]
  /** 「+」圈的视口坐标（菜单左上角贴这里，越界由 Radix 避让）。 */
  point: { x: number; y: number }
  onPick: (kind: NodeDeriveKind) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const items = React.useMemo(() => buildNodeDeriveMenuItems(verdicts, t, onPick), [onPick, t, verdicts])
  return (
    <WorkbenchMenu
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      point={point}
      items={items}
      ariaLabel={t('generationCommon.quickActions.derive.title')}
      onPointerDown={(event) => event.stopPropagation()}
      data-testid="node-derive-menu"
    />
  )
}
