// 生成页左上「画布 ↔ 列表」切换：**一颗图标按钮**，显示的是「点了去哪」的那个视图
// （画布上显示列表图标，列表上显示画布图标）。2026-10-08 用户：「只占一个 icon 空间就行，
// 不能设计出里面又有分割空间」——所以不是分段控件。
// 按钮与外壳就是画布缩放条那一族（CanvasNavigationTooltipButton + 同一层描边 / 投影），不另造样式；
// 图标对是仓库里已在用的「图 / 列表」切换（WorkflowGraphCanvas：IconLayoutBoard / IconLayoutList）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLayoutBoard, IconLayoutList } from '@tabler/icons-react'
import { TooltipProvider } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasNavigationTooltipButton } from '../../generationCanvas/components/CanvasNavigationTooltipButton'
import { useGenerationViewStore } from './generationViewStore'

export function GenerationViewToggle(): JSX.Element {
  const { t } = useTranslation()
  const view = useGenerationViewStore((state) => state.view)
  const setView = useGenerationViewStore((state) => state.setView)
  const toList = view === 'canvas'
  const label = toList ? t('generationList.view.toList') : t('generationList.view.toCanvas')
  return (
    <div
      className={cn(
        'pointer-events-auto absolute left-3 top-3 z-[9] inline-flex p-1',
        'rounded-nomi border border-workbench-border bg-nomi-paper shadow-workbench-sm',
      )}
      data-generation-view-toggle={view}
    >
      <TooltipProvider delayDuration={250} disableHoverableContent>
        <CanvasNavigationTooltipButton label={label} onClick={() => setView(toList ? 'list' : 'canvas')}>
          {toList
            ? <IconLayoutList size={15} stroke={1.8} aria-hidden="true" />
            : <IconLayoutBoard size={15} stroke={1.8} aria-hidden="true" />}
        </CanvasNavigationTooltipButton>
      </TooltipProvider>
    </div>
  )
}
