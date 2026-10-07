/**
 * [INPUT]: 依赖 react、./DirectorEditorContext、./model/hotkeys 类型、./panels/EditorSplit、./panels/viewport/DirectorViewport、
 *          ./panels/context/ContextCard、./panels/side/AssetsDrawer、./panels/topbar/RefineTopBar、./timeline/DirectorTimeline、
 *          ./scene/creation 的两个创建模式 API 类型、./scene/sceneTheme、./scene/viewSettings
 * [OUTPUT]: 对外提供 DirectorRefineShell：精修「选中才出」布局（3D-BOX 开关开时的「精修」，开关关时的旧导演台，同一个组件）
 * [POS]: 2026-10-04 用户拍板精修走方向 A（设计卡 docs/plan/2026-10-04-director-refine-select-to-show.md）：
 *        3D 视口满宽，右边默认什么都没有；**点谁，谁的属性卡才出来**（ContextCard，显隐由 store.selection derive）；
 *        大纲 / 场景设置 / 资产库各一次点击可达（顶栏「▤ 图层名 ▾」、它底部的「场景设置」、「＋ ▾」底部的「资产库」）。
 *        空场景时视口正中一句提示（往哪儿加东西）。这个壳只持有两个瞬态：场景设置卡开着、资产库抽屉开着——都不持久，关窗口就没了。
 *        时间轴、分栏比例键（director.center）、折叠记忆与旧布局完全一样，没动。
 *        2026-10-04 拍板后由 EditorStage 直接渲染，旧右栏双卡（SidePanels）与旧顶栏（DirectorTopBar）同 PR 删除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { DirectorHotkeyScope } from './model/hotkeys'
import { EditorSplit } from './panels/EditorSplit'
import { ContextCard } from './panels/context/ContextCard'
import { AssetsDrawer } from './panels/side/AssetsDrawer'
import { RefineTopBar } from './panels/topbar/RefineTopBar'
import type { ViewModeValue } from './panels/topbar/shellChrome'
import { DirectorViewport } from './panels/viewport/DirectorViewport'
import type { BoxDrawApi } from './scene/creation/useBoxDraw'
import type { CharacterPlacementApi } from './scene/creation/useCharacterPlacement'
import type { DirectorViewportTheme } from './scene/sceneTheme'
import type { ViewSettings } from './scene/viewSettings'
import { DirectorTimeline, TIMELINE_COLLAPSED_PX, TIMELINE_EMPTY_PX } from './timeline/DirectorTimeline'
import { useDirectorStore, useDirectorStoreApi } from './DirectorEditorContext'

export type DirectorRefineShellProps = {
  scopeRef: React.MutableRefObject<DirectorHotkeyScope>
  placement: CharacterPlacementApi
  boxDraw: BoxDrawApi
  cancelCreationRef: React.MutableRefObject<(() => void) | null>
  theme: DirectorViewportTheme
  viewSettings: ViewSettings
  timelineCollapsed: boolean
  timelineEmpty: boolean
  onToggleTimeline: () => void
  onResetView: () => void
  onExit: () => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  /** 旧导演台（3D-BOX 开关关）没有导演视图：不给就不画「导演 | 精修」，底部照旧给 AI 搭场景入口 */
  viewMode?: { value: ViewModeValue; onChange: (mode: ViewModeValue) => void }
}

export function DirectorRefineShell({ scopeRef, placement, boxDraw, cancelCreationRef, theme, viewSettings, timelineCollapsed, timelineEmpty, onToggleTimeline, onResetView, onExit, onOpenSettings, onOpenHelp, viewMode }: DirectorRefineShellProps): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  // 空场景时右边没有卡、左边没有大纲，视口正中说一句往哪儿加东西（旧布局靠大纲里那行「暂无实体」）
  const sceneEmpty = useDirectorStore((state) => {
    const scene = state.activeScene()
    return scene.objects.length === 0 && scene.cameras.length === 0 && scene.lights.length === 0
  })
  const [sceneSettingsOpen, setSceneSettingsOpen] = React.useState(false)
  const [assetsOpen, setAssetsOpen] = React.useState(false)
  const closeSceneSettings = React.useCallback(() => setSceneSettingsOpen(false), [])
  const closeAssets = React.useCallback(() => setAssetsOpen(false), [])
  // 场景设置和「某个对象的属性」住同一张卡：打开场景设置 = 先把选中清掉，卡才显示场景
  const openSceneSettings = React.useCallback(() => {
    store.getState().clearSelection()
    setSceneSettingsOpen(true)
  }, [store])

  return (
    <div className="relative min-h-0 flex-1" data-director-refine="select-to-show">
      <EditorSplit
        direction="vertical"
        storageKey="director.center"
        defaultRatio={0.8}
        minRatio={0.35}
        maxRatio={0.94}
        collapsedSecondPx={timelineCollapsed ? TIMELINE_COLLAPSED_PX : timelineEmpty ? TIMELINE_EMPTY_PX : undefined}
      >
        <div className="relative h-full w-full">
          <DirectorViewport
            theme={theme}
            viewSettings={viewSettings}
            scopeRef={scopeRef}
            placement={placement}
            boxDraw={boxDraw}
            cancelCreationRef={cancelCreationRef}
            showAiSceneBar={!viewMode}
          />
          {sceneEmpty ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-testid="director-refine-empty">
              <span className="rounded-nomi-lg border border-nomi-line bg-nomi-paper/90 px-3 py-1.5 text-caption text-nomi-ink-60 shadow-nomi-sm">{t('director.refine.emptyScene')}</span>
            </div>
          ) : null}
          {assetsOpen ? <AssetsDrawer onClose={closeAssets} /> : null}
          <ContextCard sceneSettingsOpen={sceneSettingsOpen} onCloseSceneSettings={closeSceneSettings} onCancelCreation={() => cancelCreationRef.current?.()} />
        </div>
        <DirectorTimeline collapsed={timelineCollapsed} onToggleCollapsed={onToggleTimeline} scopeRef={scopeRef} />
      </EditorSplit>
      <RefineTopBar
        onExit={onExit}
        onResetView={onResetView}
        onCancelCreation={() => cancelCreationRef.current?.()}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
        onOpenSceneSettings={openSceneSettings}
        onOpenAssets={() => setAssetsOpen(true)}
        viewMode={viewMode}
      />
    </div>
  )
}
