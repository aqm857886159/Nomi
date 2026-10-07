// 设计实验室 · 屏「导演台 · 群众并进「加人」」的取景台（实现后的真样子）。
//
// 2026-10-07 用户拍板：群众并进「＋→角色→群众」，加进场景后是一个群众组，模板是默认角色，动作复用动作选择弹窗。
// 这一屏每一格渲染的都是现役组件，不再有手拼的提案件：
//   · 浮层格：现役 AddObjectMenu，由真按钮点出来（＋ → 角色 → 群众 → 动作）；
//   · 放下以后：现役 store 的真动作（batchCreateCrowd / applyPosePresetToGroup，名字取现役 i18n，与 DirectorEditor 传给放置模式的一致），
//     再交给现役 SceneObjectsTab（大纲）和 ContextCard（右卡，群众组的「动作」一行）渲染。
// 地面落点本身要真 3D 视口，实验室不渲染；落点那一步由 creationCoordinates.test.ts 的放置测试钉住。
// 经 React.lazy 动态加载：导演台模块图较重，静态 import 会拖慢实验室别的屏（见 director3dbox 屏的同类注释）。
import React, { type JSX } from 'react'
import i18n from '../../../i18n'
import type { AppLocale } from '../../../i18n'
import { DirectorStoreContext } from '../../../workbench/generationCanvas/nodes/director/DirectorEditorContext'
import { DEFAULT_CROWD_ACTION_ID } from '../../../workbench/generationCanvas/nodes/director/model/defaultCharacter'
import { createDirectorStore, type DirectorStore } from '../../../workbench/generationCanvas/nodes/director/model/directorStore'
import { CreationModeContext, type CreationModeApi } from '../../../workbench/generationCanvas/nodes/director/panels/CreationModeContext'
import { ViewportApiContext, type ViewportApiRef } from '../../../workbench/generationCanvas/nodes/director/scene/ViewportApiContext'
import { AddObjectMenu } from '../../../workbench/generationCanvas/nodes/director/panels/topbar/AddObjectMenu'
import { SceneObjectsTab } from '../../../workbench/generationCanvas/nodes/director/panels/side/SceneObjectsTab'
import { ContextCard } from '../../../workbench/generationCanvas/nodes/director/panels/context/ContextCard'
import { DIRECTOR_CROWD_CELL_HEIGHT, DIRECTOR_CROWD_CELL_WIDTH } from './directorCrowdConstants'

export type CrowdCell = 'add-menu-character' | 'crowd-panel' | 'action-picker' | 'placed-group' | 'group-action-changed'

const STAGE_TITLE: Record<AppLocale, Record<CrowdCell, string>> = {
  'zh-CN': {
    'add-menu-character': '顶栏「＋」→「角色」：女人 / 男人 / 群众',
    'crowd-panel': '选「群众」：同一个浮层里设行 / 列 / 间距 / 动作，「放置群众」后点地面放下',
    'action-picker': '点「动作」：打开现有的动作选择弹窗（和时间轴加动作同一个）',
    'placed-group': '放下以后：大纲一行「群众组」，点它整体选中；右卡改整体位置，「动作」一行改整组',
    'group-action-changed': '整组改动作后：组内每个人都换了，右卡「动作」显示新动作（一次撤销全回去）',
  },
  en: {
    'add-menu-character': 'Top bar "+" → "Character": Woman / Man / Crowd',
    'crowd-panel': 'Choose "Crowd": rows / columns / spacing / action in the same popover; "Place crowd", then click the ground',
    'action-picker': 'Click "Action": the existing action picker opens (same one as adding an action on the timeline)',
    'placed-group': 'After placing: one "Crowd group" outliner row, click selects it whole; the card moves it, the "Action" row changes the whole group',
    'group-action-changed': 'After changing the group action: everyone changed, the card shows the new action (one undo reverts all)',
  },
}

function useLocale(locale: AppLocale): void {
  React.useMemo(() => {
    void i18n.changeLanguage(locale)
  }, [locale])
}

const NOOP = (): void => undefined
const NO_POINTER = (): boolean => false
const CREATION = {
  placement: { active: false, gender: null, crowd: null, headingDeg: 0, ghostRef: { current: null }, start: NOOP, cancel: NOOP, onPointerDown: NO_POINTER, onPointerMove: NO_POINTER, onPointerUp: NO_POINTER, onPointerLeave: NOOP },
  boxDraw: { active: false, step: 'idle', dimensions: { width: 1, depth: 1, height: 1 }, ghostRef: { current: null }, start: NOOP, cancel: NOOP, onPointerDown: NO_POINTER, onPointerMove: NO_POINTER, onPointerUp: NO_POINTER },
} as unknown as CreationModeApi

function Frame({ cell, locale, children }: { cell: CrowdCell; locale: AppLocale; children: React.ReactNode }): JSX.Element {
  return (
    <div className="relative overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg" style={{ width: DIRECTOR_CROWD_CELL_WIDTH, height: DIRECTOR_CROWD_CELL_HEIGHT }} data-design-lab-stage="director-crowd">
      <div className="absolute inset-x-0 top-0 z-[1] border-b border-nomi-line bg-nomi-paper px-3 py-2 text-caption font-semibold text-nomi-ink-80">{STAGE_TITLE[locale][cell]}</div>
      <div className="absolute inset-x-0 bottom-0 top-9">{children}</div>
    </div>
  )
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

async function clickWhenPresent(find: () => HTMLElement | undefined): Promise<void> {
  for (let tries = 0; tries < 600; tries += 1) {
    const target = find()
    if (target) {
      target.click()
      await nextFrame()
      return
    }
    await nextFrame()
  }
  throw new Error('director-crowd lab: 等不到要点的真按钮')
}

const popoverButton = (text: string) => (): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[data-nomi-escape-layer="director-popover"] button')].find((button) => button.textContent?.includes(text))

/** 走真按钮：＋ →「角色」→「群众」→（可选）「动作」。 */
async function drive(stage: 'character' | 'crowd' | 'action'): Promise<void> {
  await clickWhenPresent(() => document.querySelector<HTMLElement>('[data-testid="director-add-menu"]') ?? undefined)
  await clickWhenPresent(popoverButton(i18n.t('director.creation.character')))
  if (stage === 'character') return
  await clickWhenPresent(popoverButton(i18n.t('director.creation.crowd')))
  if (stage === 'crowd') return
  await clickWhenPresent(() => document.querySelector<HTMLElement>('[data-testid="director-action-pick"]') ?? undefined)
}

function AddMenu({ locale, stage }: { locale: AppLocale; stage: 'character' | 'crowd' | 'action' }): JSX.Element {
  useLocale(locale)
  const store = React.useMemo(() => createDirectorStore({ defaultSceneName: i18n.t('director.node.sceneDefaultName') }), [])
  const viewportRef = React.useRef(null) as ViewportApiRef
  React.useEffect(() => {
    void drive(stage)
  }, [stage])
  return (
    <DirectorStoreContext.Provider value={store}>
      <CreationModeContext.Provider value={CREATION}>
        <ViewportApiContext.Provider value={viewportRef}>
          <div className="flex h-12 items-center gap-2 border-b border-nomi-line bg-nomi-paper px-3">
            <AddObjectMenu onOpenAssets={NOOP} />
          </div>
        </ViewportApiContext.Provider>
      </CreationModeContext.Provider>
    </DirectorStoreContext.Provider>
  )
}

/** 放下以后：现役 store 真动作建出来的场景 → 现役大纲 + 现役右卡。 */
function PlacedGroup({ locale, changed }: { locale: AppLocale; changed: boolean }): JSX.Element {
  useLocale(locale)
  const store = React.useMemo<DirectorStore>(() => {
    const created = createDirectorStore({ defaultSceneName: i18n.t('director.node.sceneDefaultName') })
    const state = created.getState()
    const groupId = state.batchCreateCrowd({
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      rows: 2,
      cols: 3,
      spacing: 2,
      actionId: DEFAULT_CROWD_ACTION_ID,
      groupName: i18n.t('director.creation.crowdGroupName'),
      memberName: i18n.t('director.creation.crowdMemberName'),
    })
    if (groupId && changed) created.getState().applyPosePresetToGroup(groupId, 'standard_walk')
    return created
  }, [changed, locale])
  return (
    <DirectorStoreContext.Provider value={store}>
      <div className="flex h-full">
        <div className="w-[300px] shrink-0 overflow-auto border-r border-nomi-line bg-nomi-paper">
          <SceneObjectsTab />
        </div>
        <div className="relative min-w-0 flex-1">
          <ContextCard sceneSettingsOpen={false} onCloseSceneSettings={NOOP} onCancelCreation={NOOP} />
        </div>
      </div>
    </DirectorStoreContext.Provider>
  )
}

export function DirectorCrowdStage({ cell, locale, release }: { cell: CrowdCell; locale: AppLocale; release: () => void }): JSX.Element {
  useLocale(locale)
  React.useEffect(() => {
    // 真按钮点击 / portal 定位 / 弹窗里的 3D 预览都在挂载后落定：数帧后释放就绪持有
    let frames = 0
    let raf = 0
    const tick = () => {
      frames += 1
      if (frames < (cell === 'action-picker' ? 240 : 60)) raf = requestAnimationFrame(tick)
      else release()
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      release()
    }
  }, [cell, release])
  return (
    <Frame cell={cell} locale={locale}>
      {cell === 'add-menu-character' ? <AddMenu locale={locale} stage="character" /> : null}
      {cell === 'crowd-panel' ? <AddMenu locale={locale} stage="crowd" /> : null}
      {cell === 'action-picker' ? <AddMenu locale={locale} stage="action" /> : null}
      {cell === 'placed-group' ? <PlacedGroup locale={locale} changed={false} /> : null}
      {cell === 'group-action-changed' ? <PlacedGroup locale={locale} changed /> : null}
    </Frame>
  )
}
