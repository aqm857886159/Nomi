import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchMenu } from '../../../design/menu'
import type { ConnectionCreateVerdict } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { buildNodeAddInputMenuItems, buildNodeDeriveMenuItems, type NodeDeriveKind } from './nodeDeriveMenuModel'

/**
 * 节点拉环的菜单——**两侧一个组件、一个原语**（2026-10-08 拍板 ②）：
 * - 右「+」→ **用这个节点生成…**：选一项 = 新建这一类空节点 + 连好线（本卡在上游）+ 选中它；
 * - 左「+」→ **给它加输入**：选一项 = 新建这一类空节点接进本卡（新节点在上游）；另有「从素材库添加…」「在画布上点选」。
 * 点一下「+」（不拖）与拖线到空白处松手出的是同一个菜单、同一份判据（quickActions/connectionMenuModel）；都不生成、不花钱。
 *
 * **接不上的不藏，灰掉并在第二行说原因**（§1.6 C1 / C4：可点即有效，否则禁用并说明为什么）。
 */
export function NodeDeriveMenu({
  side = 'right',
  target,
  verdicts,
  point,
  onPick,
  onFromAssets,
  onPickOnCanvas,
  onClose,
}: {
  side?: 'left' | 'right'
  /** 左「+」的那张卡（原因里要说「剪辑节点不收文字」）。右「+」不用。 */
  target?: Pick<GenerationCanvasNode, 'kind'>
  /** 每一类能不能接、为什么不能（NODE_DERIVE_KINDS 全集）。 */
  verdicts: readonly ConnectionCreateVerdict<NodeDeriveKind>[]
  /** 视口坐标：点「+」= 圈下；松手 = 松手点（菜单左上角贴这里，越界由 Radix 避让）。 */
  point: { x: number; y: number }
  onPick: (kind: NodeDeriveKind) => void
  onFromAssets?: () => void
  onPickOnCanvas?: () => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const items = React.useMemo(() => (side === 'left' && target
    ? buildNodeAddInputMenuItems(verdicts, target, t, { onPick, onFromAssets: onFromAssets ?? onClose, onPickOnCanvas: onPickOnCanvas ?? onClose })
    : buildNodeDeriveMenuItems(verdicts, t, onPick)), [onClose, onFromAssets, onPick, onPickOnCanvas, side, t, target, verdicts])
  const title = side === 'left' ? t('generationCommon.quickActions.addInput.title') : t('generationCommon.quickActions.derive.title')
  return (
    <WorkbenchMenu
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      point={point}
      items={items}
      ariaLabel={title}
      onPointerDown={(event) => event.stopPropagation()}
      data-testid={side === 'left' ? 'node-add-input-menu' : 'node-derive-menu'}
    />
  )
}
