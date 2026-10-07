/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 NomiSegmented、../../../../../../vendor/tablerIcons、
 *          ../../DirectorEditorContext、../../model/hotkeys（DIRECTOR_HOTKEYS / formatHotkey）、./useDirectorToolChange
 *          onCancelCreation 回调：点击任意工具前取消角色/方块/路径创建模式
 * [OUTPUT]: 对外提供 ViewportToolbar：精修顶栏的「工具」——选择 / 移动 / 旋转 / 缩放（切工具走 ./useDirectorToolChange）
 * [POS]: director/panels/viewport 的工具簇，由 topbar/RefineTopBar 装配。画线 / 逐点不在这里：它们是「给选中的角色或机位画路径」，
 *        2026-10-04 用户拍板住属性卡头（panels/context/ContextCard，就近，§1.5.1 L2）——放顶栏按选中显隐会让顶栏变宽、居中的
 *        「导演 | 精修」跟着跳。画线模式开着时这里四个都不亮（当前工具在卡头那颗）。编辑模式提示住检查器「空间变换」卡。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSegmented } from '../../../../../../design'
import { IconArrowsMove, IconPointer, IconResize, IconRotate } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore } from '../../DirectorEditorContext'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { useDirectorToolChange } from './useDirectorToolChange'

type ToolKey = 'select' | 'translate' | 'rotate' | 'scale'

const TOOL_ICONS: Record<ToolKey, React.ReactNode> = {
  select: <IconPointer size={16} stroke={1.9} />,
  translate: <IconArrowsMove size={16} stroke={1.9} />,
  rotate: <IconRotate size={16} stroke={1.9} />,
  scale: <IconResize size={16} stroke={1.9} />,
}
const TOOL_ORDER: ToolKey[] = ['select', 'translate', 'rotate', 'scale']

export function ViewportToolbar({ onCancelCreation }: { onCancelCreation?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const transformMode = useDirectorStore((state) => state.transformMode)
  const drawMode = useDirectorStore((state) => state.drawMode)
  const toolValue = drawMode ? '' : transformMode ?? 'select'
  const onToolChange = useDirectorToolChange(onCancelCreation)

  return (
    <div
      className="flex items-center gap-1"
      role="toolbar"
      aria-label={t('director.topbar.toolsAria')}
      data-testid="director-viewport-toolbar"
    >
      <NomiSegmented
        ariaLabel={t('director.topbar.toolsAria')}
        density="compact"
        fit="content"
        value={toolValue}
        itemClassName="px-1"
        options={TOOL_ORDER.map((key) => ({
          value: key,
          label: <span className="inline-flex items-center justify-center">{TOOL_ICONS[key]}</span>,
          title: `${t(`director.topbar.${key}`)} (${formatHotkey(DIRECTOR_HOTKEYS[key])})`,
        }))}
        onChange={onToolChange}
      />
    </div>
  )
}
