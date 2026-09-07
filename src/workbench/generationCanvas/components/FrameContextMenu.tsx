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
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconLayersSubtract,
  IconPencil,
  IconPlayerPlay,
  IconTimeline,
  IconFrameOff,
} from '@tabler/icons-react'
import { cn } from '../../../utils/cn'

export type FrameContextMenuAction = 'edit' | 'generate' | 'timeline' | 'collapse' | 'dissolve'

type FrameContextMenuProps = {
  className?: string
  style?: React.CSSProperties
  frameName: string
  /** 框里一个可生成的节点都没有 → 禁用并说明为什么（§1.6 C1：可点即有效，否则禁用+解释）。 */
  canGenerate: boolean
  /** 框里一段可进时间轴的画面都没有 → 同上。 */
  canSendToTimeline: boolean
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
  ]

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
      {items.map((item, index) => {
        const Icon = item.icon
        return (
          <React.Fragment key={item.action}>
            {index === items.length - 1 ? (
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
