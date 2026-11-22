/**
 * [INPUT]: 依赖 react、../../../../../design（WorkbenchMenu）
 * [OUTPUT]: 对外提供 TimelineMenuItem 类型与 TimelineContextMenu（按指针位置定位的右键菜单；外点 / Esc / 方向键全交 WorkbenchMenu）
 * [POS]: director/timeline 的右键菜单适配层（清单 §5.2 轨道右键/加号菜单）：委托全站唯一 WorkbenchMenu（Radix Portal + 边缘避让 + 键盘导航）；
 *        菜单项由 DirectorTimeline 按上下文拼，透传 escapeLayer="director-timeline-menu" 让编辑器的 Esc 归属链先关它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../../../design'

export type TimelineMenuItem =
  | { id: string; label: string; disabled?: boolean; title?: string; danger?: boolean; onSelect: () => void }
  | { id: string; separator: true }

export function TimelineContextMenu({ x, y, items, onClose }: { x: number; y: number; items: TimelineMenuItem[]; onClose: () => void }): JSX.Element {
  const menuItems: WorkbenchMenuNode[] = items.map((item) =>
    'separator' in item
      ? { kind: 'separator', id: item.id }
      : {
          id: item.id,
          label: item.label,
          disabled: item.disabled,
          disabledReason: item.title,
          danger: item.danger,
          onSelect: () => {
            if (item.disabled) return
            item.onSelect()
          },
        },
  )

  return (
    <WorkbenchMenu
      open
      onOpenChange={(open) => { if (!open) onClose() }}
      point={{ x, y }}
      escapeLayer="director-timeline-menu"
      className="min-w-[200px] rounded-nomi-lg p-1 text-body-sm text-nomi-ink shadow-nomi-lg"
      itemClassName="min-h-0 rounded-nomi-sm px-2 py-1"
      separatorClassName="my-1 mx-0 bg-nomi-line-soft"
      items={menuItems}
    />
  )
}
