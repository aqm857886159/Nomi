import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconClipboard,
  IconCopy,
  IconCut,
  IconLayersSubtract,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../design/menu'
import { platformModifier } from '../../../design/platformShortcut'

/**
 * 节点右键菜单（2026-08-20 用户拍板样张）。
 *
 * 为什么要它：复制/剪切/粘贴自 2026-06-12 就能用，但画布上**一个可见入口都没有**——
 * 右键节点原先被排除名单挡掉、什么都不弹，节点工具条与多选工具条也都没有复制钮，
 * 只剩键盘一条路且只写在帮助面板里。群反馈原话是「copy 键是啥呢」——问的是「键在哪」。
 *
 * 每项右侧标出快捷键：菜单是**发现入口**，快捷键是**加速器**（§1.5.2 第 1 条）——
 * 用户点一次菜单就顺带学会了键，下次不必再来。
 *
 * 层级：L3 收纳（§1.5.1，一次点击可达），不占任何常驻预算，不新增平铺按钮。
 *
 * **2026-09-08 刀 1：只换实现，不动形态。** 五项、顺序、文案、图标、快捷键、两处禁用及其
 * 解释、分隔线的位置（倒数第 2 项前）全部照旧，壳换成 `src/design/menu.tsx` 的 `WorkbenchMenu`
 * （行为走 Radix）。宿主 `useCanvasContextNodeMenu.ts` 的指针编排（pointerup 才提交、
 * 右键平移和弦、node/frame/blank/selection 四分流）**一行未动**——菜单开不开、开在哪仍是它算的，
 * 原语只接手定位/避让/键盘/焦点/点外关闭。
 *
 * 顺手消失的两样（不是新形态，是同一件事换了更准的做法）：
 *   · 定位从 stage 相对 `absolute` + 写死 `NODE_MENU_HEIGHT=196` 夹边，改为按视口坐标
 *     + Radix 真实测量避让；项数变了也不会夹错；
 *   · 禁用项原先要外包一层 `<span title>` 才触发得了 tooltip（`<button disabled>` 自己不触发），
 *     Radix 的 Item 不是 disabled 的 button，`title` 直接挂得上，那层壳没了。
 */
export type NodeContextMenuAction = 'copy' | 'cut' | 'paste' | 'group' | 'delete'

type NodeContextMenuProps = {
  /** 宿主给的识别类（走查按 `.generation-canvas-v2__node-context-menu` 找它）。 */
  className?: string
  /** 右键那一下的视口坐标（`CanvasContextNodeMenu.clientX/clientY`）。 */
  point: { x: number; y: number }
  /** 剪贴板为空 → 粘贴禁用并说明为什么（§1.6 C1：可点即有效，否则禁用+解释）。 */
  canPaste: boolean
  /** 少于两个选中项 → 建组禁用并说明为什么。 */
  canGroup: boolean
  onAction: (action: NodeContextMenuAction) => void
  onClose: () => void
  /**
   * 菜单里的 pointerdown 要不要往上冒。画布宿主在 `window` 上挂了「点外面就关菜单」，
   * 而菜单现在 Portal 到 body、就在 window 的冒泡路径上——不拦住，点自己的菜单项
   * 会先把菜单关掉。迁移前靠菜单根上的同一句 stopPropagation，照抄。
   */
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
}

export default function NodeContextMenu({
  className,
  point,
  canPaste,
  canGroup,
  onAction,
  onClose,
  onPointerDown,
}: NodeContextMenuProps): JSX.Element {
  const { t } = useTranslation()
  const mod = platformModifier(navigator.platform)

  const items: WorkbenchMenuNode[] = [
    { id: 'copy', label: t('canvas.nodeMenuCopy'), shortcut: `${mod} C`, icon: IconCopy, onSelect: () => onAction('copy') },
    { id: 'cut', label: t('canvas.nodeMenuCut'), shortcut: `${mod} X`, icon: IconCut, onSelect: () => onAction('cut') },
    {
      id: 'paste',
      label: t('canvas.nodeMenuPaste'),
      shortcut: `${mod} V`,
      icon: IconClipboard,
      disabled: !canPaste,
      disabledReason: t('canvas.nodeMenuPasteEmpty'),
      onSelect: () => onAction('paste'),
    },
    {
      id: 'group',
      label: t('canvas.nodeMenuGroup'),
      shortcut: `${mod} G`,
      icon: IconLayersSubtract,
      disabled: !canGroup,
      disabledReason: t('canvas.nodeMenuGroupNeedsTwo'),
      onSelect: () => onAction('group'),
    },
    // 分隔线在倒数第 2 项前：删除独占一段（迁移前是渲染时按 index 插的同一个位置）。
    { kind: 'separator', id: 'before-delete' },
    { id: 'delete', label: t('canvas.nodeMenuDelete'), shortcut: 'Del', icon: IconTrash, danger: true, onSelect: () => onAction('delete') },
  ]

  return (
    <WorkbenchMenu
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      point={point}
      items={items}
      ariaLabel={t('canvas.nodeMenu')}
      onPointerDown={onPointerDown}
      // 现状原样带过来：172px 宽、面板底色与工具条同一档（`bg-workbench-surface-solid`
      // 迁移前挂在每一项上，等价于面板整块——两者都解析到 `--nomi-paper`，画面不变）。
      className={cn('w-[172px]', className)}
      data-testid="canvas-node-context-menu"
    />
  )
}
