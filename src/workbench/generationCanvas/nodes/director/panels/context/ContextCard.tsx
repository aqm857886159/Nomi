/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchIconButton、../../../../../../vendor/tablerIcons、../../DirectorEditorContext、../../model/hotkeys、
 *          ../inspector/ContextInspector、../topbar/topChrome 的 DIRECTOR_TOP_CHROME_PX、../viewport/useDirectorToolChange、./useDismissOnEscape
 * [OUTPUT]: 对外提供 ContextCard（精修右侧那一张「选中才出」的属性卡）
 * [POS]: director/panels/context 的宿主。卡里就是原来的 ContextInspector，一个字段不改，只换住处：
 *        **出不出现由 store.selection derive**（选中的物体 / 机位 / 灯在当前图层里找得到），不另存「卡开没开」；× = clearSelection()。
 *        唯一的例外是「场景设置」：没有选中时由壳的瞬态 sceneSettingsOpen 打开同一张卡（检查器无选中时本来就显示场景图层配置）；
 *        一旦选中了实体，场景设置让位（这里把它关掉），之后取消选中卡就收走，不会悄悄回到场景设置。
 *        浮层不占流：视口宽度不随卡变，3D 画面不 resize；只有卡本身挡指针，卡外全穿透（09-09「看得见点不到的暗区」教训）。
 *        高度由内容算（检查器内容高于可用高度时卡内滚动），宽度固定 320（字段标签列 64 + 三轴数字框放得下 0.00）——卡里是对齐成列的字段，不是一组按钮（§1.5.2 第 4 条的豁免）。
 *        选中角色或机位时卡头多两颗「画线 / 逐点」：它们是「给这个角色 / 机位画路径」，L2 情境动作就近住在目标的卡上（§1.5.1），
 *        不再常驻顶栏（常驻时没选主体也能点、点了再 toast 拒绝；放顶栏按选中显隐又会让顶栏变宽、中间的「导演 | 精修」跟着跳）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../../../../design'
import { IconPencil, IconRoute } from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { ContextInspector } from '../inspector/ContextInspector'
import { DIRECTOR_TOP_CHROME_PX } from '../topbar/topChrome'
import { useDirectorToolChange } from '../viewport/useDirectorToolChange'
import { useDismissOnEscape } from './useDismissOnEscape'

const CONTEXT_CARD_WIDTH = 320
const EDGE = 12

/** 当前有没有「检查器能显示的选中」：选中 id 在当前图层里真找得到（删掉 / 撤销后的悬空 id 不算）。 */
function useHasInspectableSelection(): boolean {
  return useDirectorStore((state) => Boolean(state.findObject(state.selection.objectId) || state.findCamera(state.selection.cameraId) || state.findLight(state.selection.lightId)))
}

/** 画路径的主体 = 选中的角色或机位（与 scene/creation/usePathDraw 的 subjectOf 同一判据） */
function useHasPathSubject(): boolean {
  return useDirectorStore((state) => Boolean(state.findCamera(state.selection.cameraId) || state.findObject(state.selection.objectId)?.type === 'character'))
}

/** 卡头的「画线 / 逐点」：按下 = 进对应的画路径模式，再按 = 回到选择。快捷键 4 / 5 照旧。 */
function PathDrawButtons({ onCancelCreation }: { onCancelCreation: () => void }): JSX.Element {
  const { t } = useTranslation()
  const drawMode = useDirectorStore((state) => state.drawMode)
  const changeTool = useDirectorToolChange(onCancelCreation)
  const button = (key: 'drawPencil' | 'waypoint', mode: 'pencil' | 'waypoint', icon: React.ReactNode) => {
    const on = drawMode === mode
    return (
      <WorkbenchIconButton
        size="sm"
        icon={icon}
        label={`${t(`director.topbar.${key}`)} (${formatHotkey(DIRECTOR_HOTKEYS[key])})`}
        aria-pressed={on}
        className={on ? 'bg-nomi-accent-soft text-nomi-accent' : ''}
        data-testid={`director-card-${key}`}
        onClick={() => changeTool(on ? 'select' : key)}
      />
    )
  }
  return (
    <>
      {button('drawPencil', 'pencil', <IconPencil size={16} stroke={1.9} />)}
      {button('waypoint', 'waypoint', <IconRoute size={16} stroke={1.9} />)}
      <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden />
    </>
  )
}

export function ContextCard({ sceneSettingsOpen, onCloseSceneSettings, onCancelCreation }: { sceneSettingsOpen: boolean; onCloseSceneSettings: () => void; onCancelCreation: () => void }): JSX.Element | null {
  const store = useDirectorStoreApi()
  const hasSelection = useHasInspectableSelection()
  const hasPathSubject = useHasPathSubject()
  const visible = hasSelection || sceneSettingsOpen

  // 选中实体时场景设置让位：卡换成这个实体的检查器；之后取消选中，卡收走而不是退回场景设置
  React.useEffect(() => {
    if (hasSelection && sceneSettingsOpen) onCloseSceneSettings()
  }, [hasSelection, onCloseSceneSettings, sceneSettingsOpen])

  useDismissOnEscape(sceneSettingsOpen && !hasSelection, onCloseSceneSettings)

  // 全局 toast 容器读这个变量让开右上角：卡在时让出卡宽，卡不在时不让（以前右栏常驻，一直让 432）
  React.useEffect(() => {
    if (!visible) return undefined
    const root = document.documentElement
    root.style.setProperty('--nomi-director-side-width', `${CONTEXT_CARD_WIDTH + EDGE}px`)
    return () => {
      root.style.removeProperty('--nomi-director-side-width')
    }
  }, [visible])

  if (!visible) return null
  const close = () => {
    store.getState().clearSelection()
    onCloseSceneSettings()
  }
  return (
    <div
      className="pointer-events-none absolute z-[5] flex flex-col"
      style={{ right: EDGE, top: DIRECTOR_TOP_CHROME_PX, bottom: EDGE, width: CONTEXT_CARD_WIDTH }}
      data-testid="director-context-card"
      data-nomi-right-panel="director"
      // 只有「场景设置」这一态自己吃 Esc（关卡）；选中实体时 Esc 归壳：清选中，卡随之收走
      data-nomi-escape-layer={hasSelection ? undefined : 'director-scene-settings'}
      data-nomi-hotkeys="pass"
    >
      <div className="pointer-events-auto flex max-h-full min-h-0 flex-col overflow-hidden rounded-nomi-lg border border-nomi-line bg-nomi-paper shadow-nomi-lg">
        <ContextInspector onClose={close} headerActions={hasPathSubject ? <PathDrawButtons onCancelCreation={onCancelCreation} /> : null} />
      </div>
    </div>
  )
}
