/**
 * 框的操作菜单——头部那颗 ⋯ 和**框边右键**打开的是**同一份**。
 *
 * 为什么必须同一份：2026-09-06 之前框上右键弹的是「添加节点」（落点被反向定义吞成空白，
 * 见 canvasPointerGestureModel 的四分表），框的改名/解散/整框动作在画布上一个都不可达。
 * 修法不是「再加一个入口」，是让两条手势指向同一张清单——否则它们会慢慢长出不同的项。
 *
 * 层级：L3 收纳（§1.5.1，一次点击可达），不占常驻预算。视觉与 NodeContextMenu 同款，
 * 用户不必学第二种菜单长相。
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconLayersSubtract,
  IconPencil,
  IconPlayerPlay,
  IconTimeline,
  IconFrameOff,
  IconTrash,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'

export type FrameContextMenuAction = 'edit' | 'generate' | 'timeline' | 'collapse' | 'dissolve' | 'delete'

type FrameContextMenuProps = {
  className?: string
  style?: React.CSSProperties
  frameName: string
  /** 框里一个可生成的节点都没有 → 禁用并说明为什么（§1.6 C1：可点即有效，否则禁用+解释）。 */
  canGenerate: boolean
  /** 框里一段可进时间轴的画面都没有 → 同上。 */
  canSendToTimeline: boolean
  /** 不显示的动作（同一份菜单，按入口排除）；右键菜单不传，保持完整。 */
  exclude?: readonly FrameContextMenuAction[]
  onAction: (action: FrameContextMenuAction) => void
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
}

export default function FrameContextMenu({
  className,
  style,
  frameName,
  canGenerate,
  canSendToTimeline,
  exclude,
  onAction,
  onPointerDown,
  onContextMenu,
}: FrameContextMenuProps): JSX.Element {
  const { t } = useTranslation()
  const items: {
    action: FrameContextMenuAction
    label: string
    icon: typeof IconPencil
    hint?: string
    disabled?: boolean
    disabledReason?: string
  }[] = [
    { action: 'edit', label: t('generationCommon.canvas.group.menuEdit'), icon: IconPencil },
    {
      action: 'generate',
      label: t('generationCommon.canvas.group.menuGenerate'),
      icon: IconPlayerPlay,
      disabled: !canGenerate,
      disabledReason: t('generationCommon.canvas.group.generateEmpty'),
    },
    {
      action: 'timeline',
      label: t('generationCommon.canvas.group.menuTimeline'),
      icon: IconTimeline,
      disabled: !canSendToTimeline,
      disabledReason: t('generationCommon.canvas.group.timelineEmpty'),
    },
    { action: 'collapse', label: t('generationCommon.canvas.group.menuCollapse'), icon: IconLayersSubtract },
    {
      action: 'dissolve',
      label: t('generationCommon.canvas.group.menuDissolve'),
      icon: IconFrameOff,
      // 解散不是删除：这句灰字就是那个区别本身，不写用户不敢点（实测里最容易被误当成删除的一项）。
      hint: t('generationCommon.canvas.group.menuDissolveHint'),
    },
    // 删除 = 框连同里面的东西一起删（与选中框按 Delete 同一个动作，⌘Z 一次撤回）。空框只能从这里或 Delete 删。
    {
      action: 'delete',
      label: t('generationCommon.canvas.group.menuDelete'),
      icon: IconTrash,
      hint: t('generationCommon.canvas.group.menuDeleteHint'),
    },
  ]

  const visibleItems = items.filter((item) => !exclude?.includes(item.action))
  // 分隔线放在「解散」前；工具条「⋯」排除了解散时，改放在「删除」前。
  const dividerAction = visibleItems.some((item) => item.action === 'dissolve') ? 'dissolve' : 'delete'
  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar__frame-menu',
        'absolute grid gap-0.5 w-[212px] p-[6px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-pop',
        className,
      )}
      role="menu"
      aria-label={t('generationCommon.canvas.group.moreActions', { name: frameName })}
      data-frame-menu="true"
      style={style}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
    >
      {visibleItems.map((item) => {
        const Icon = item.icon
        return (
          <React.Fragment key={item.action}>
            {/* 「拆掉 / 删掉框」那一段从解散起，前面画一条分隔线。 */}
            {item.action === dividerAction ? (
              <div className={cn('h-px my-1 mx-2 bg-nomi-line')} aria-hidden="true" />
            ) : null}
            {/* 禁用的 <button> 自己不触发 title（浏览器行为）→ 外层包一层承载它（§1.6 C1）。 */}
            <span title={item.disabled ? item.disabledReason : undefined} className={cn('contents')}>
              <button
                type="button"
                className={cn(
                  'grid w-full min-h-8 px-2 py-1 border-0 rounded-nomi text-left',
                  'bg-workbench-surface-solid font-[inherit] text-caption',
                  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.8]',
                  item.disabled
                    ? 'text-nomi-ink-40 cursor-not-allowed [&_svg]:text-nomi-ink-30'
                    : 'text-workbench-ink cursor-pointer hover:bg-nomi-ink-05 [&_svg]:text-nomi-ink-60',
                )}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => onAction(item.action)}
              >
                <span className={cn('inline-flex items-center gap-1.5')}>
                  <Icon />
                  {item.label}
                </span>
                {item.hint ? (
                  <span className={cn('pl-[22px] text-micro text-nomi-ink-40')}>{item.hint}</span>
                ) : null}
              </button>
            </span>
          </React.Fragment>
        )
      })}
    </div>
  )
}
