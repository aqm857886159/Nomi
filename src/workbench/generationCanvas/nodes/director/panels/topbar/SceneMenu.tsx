/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../vendor/tablerIcons、../../DirectorEditorContext、../Popover、../side/SceneObjectsTab
 * [OUTPUT]: 对外提供 SceneMenu：精修顶栏左簇的「▤ 图层名 ▾」——点开是大纲（搜索 + 图层 + 对象树，即原右栏上卡的 SceneObjectsTab 原样），
 *           底部一行「场景设置」打开右侧属性卡的场景设置态
 * [POS]: director/panels/topbar 的场景入口（精修「选中才出」布局）。原来三处各管一段：顶栏「① 场景」只能切图层、右栏上卡常驻大纲、
 *        没选中东西时下卡默认显示场景设置。三件事都是「这个场景里有什么、怎么设」一个心智，收成一个触发器；
 *        切图层只剩大纲里的图层行这一个家（一功能一个家，§1.5.2），顶栏不再另有一个图层下拉。
 *        浮层宽度跟内容走（最长的那一行），上限 320；点对象行只改选中，浮层不关——用户可能在挨个看。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAdjustmentsHorizontal, IconChevronDown, IconStack2 } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore } from '../../DirectorEditorContext'
import { Popover, PopoverItem } from '../Popover'
import { SceneObjectsTab } from '../side/SceneObjectsTab'

// 图层名封顶 96px，长名字截断；窄壳（compact）里只留 ▤ 图标——全名都在触发器的悬停里
const NAME_STYLE: React.CSSProperties = { maxWidth: 96 }

export function SceneMenu({ onOpenSceneSettings, compact = false }: { onOpenSceneSettings: () => void; compact?: boolean }): JSX.Element {
  const { t } = useTranslation()
  const sceneName = useDirectorStore((state) => state.activeScene().name)
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])

  return (
    <Popover
      open={open}
      onClose={close}
      side="bottom"
      align="start"
      panelClassName="flex w-max min-w-[240px] max-w-[320px] flex-col p-1"
      passEditorHotkeys
      trigger={
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-nomi-sm px-2 text-body-sm font-semibold text-nomi-ink transition-colors hover:bg-workbench-hover aria-expanded:bg-nomi-accent-soft aria-expanded:text-nomi-accent"
          aria-label={t('director.topbar.sceneMenuAria', { name: sceneName })}
          title={t('director.topbar.sceneMenuAria', { name: sceneName })}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="director-scene-menu"
          onClick={() => setOpen((value) => !value)}
        >
          <IconStack2 size={16} stroke={1.9} className="shrink-0 text-nomi-ink-40" />
          {compact ? null : <span className="min-w-0 truncate" style={NAME_STYLE}>{sceneName}</span>}
          <IconChevronDown size={14} stroke={1.9} className="shrink-0 text-nomi-ink-40" />
        </button>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col" data-testid="director-scene-menu-panel">
        <SceneObjectsTab />
      </div>
      <div className="mt-1 shrink-0 border-t border-nomi-line-soft pt-1">
        <PopoverItem
          onClick={() => {
            close()
            onOpenSceneSettings()
          }}
        >
          <IconAdjustmentsHorizontal size={16} stroke={1.9} />
          <span className="flex-1 text-left">{t('director.topbar.sceneSettings')}</span>
        </PopoverItem>
      </div>
    </Popover>
  )
}
