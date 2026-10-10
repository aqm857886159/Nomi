// 顶栏里「画布 ↔ 列表」的一个图标切换（外壳 #1136 在 40px 顶栏留的 viewSwitcher 槽，紧挨着「生成」，只在生成页出现）。
// 用户 10-10 拍板：「只需要一个 icon 转换就行」「页面里面也不需要什么去列表」——这是画布 / 列表之间**唯一**的切换入口。
// 图标显示**点了会切到的那个视图**（画布上显示列表图标、列表上显示画布图标），tooltip / aria-label 写明动作「切到列表 / 切到画布」，
// 避免「图标是指当前在哪还是点了去哪」的歧义。外观与顶栏右簇的图标按钮同一份样式（barIconButton）。
// 这里只做图标组件本身：槽的位置 / 布局归外壳线（ShellTopBar），不在这里动。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLayoutBoard, IconLayoutList } from '@tabler/icons-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../design'
import { BAR_ICON_BUTTON } from '../../../ui/app-shell/shell/barIconButton'
import { useGenerationViewStore } from './generationViewStore'

export function GenerationViewSwitcher(): JSX.Element {
  const { t } = useTranslation()
  const view = useGenerationViewStore((state) => state.view)
  const setView = useGenerationViewStore((state) => state.setView)
  const toList = view === 'canvas'
  const label = toList ? t('generationList.view.toList') : t('generationList.view.toCanvas')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={BAR_ICON_BUTTON}
          aria-label={label}
          data-generation-view-switcher={view}
          onClick={() => setView(toList ? 'list' : 'canvas')}
        >
          {toList ? <IconLayoutList size={18} stroke={1.5} aria-hidden="true" /> : <IconLayoutBoard size={18} stroke={1.5} aria-hidden="true" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
