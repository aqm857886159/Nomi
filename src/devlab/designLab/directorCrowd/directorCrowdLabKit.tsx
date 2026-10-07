// 设计实验室 · 屏「导演台 · 群众并进「加人」」的取景台。
//
// 2026-10-07 用户反馈：「批量生成群众队列」是个独立面板，不在加人那里；角色里弄个群众，复用加人那一套。
// 这一屏只出样张，不改产品行为。每一格用的都是现役导演台的真组件：
//   · 现状格：现役 AddObjectMenu（点真「＋」→「角色」）、现役 ContextCard（选中真角色，群众卡在基础页底部）；
//   · 提案格：同一个现役 Popover / PopoverItem / SliderNumberField / WorkbenchButton 拼出「角色」子菜单多一项「群众」，
//     选了群众在同一个浮层里展开行 / 列 / 间距 + 确认键（提案态的菜单项与按钮文案是本文件里的实验室文案，产品里还没有）；
//   · 「加进场景以后」两格：现役 store 的真动作（addObject / batchCreateCrowd / deleteObject / renameObject）建出场景，
//     再交给现役 SceneObjectsTab（大纲）和 ContextCard 渲染。
// 经 React.lazy 动态加载：导演台模块图较重，静态 import 会拖慢实验室别的屏（见 director3dbox 屏的同类注释）。
import React, { type JSX } from 'react'
import i18n from '../../../i18n'
import type { AppLocale } from '../../../i18n'
import { WorkbenchButton, WorkbenchIconButton } from '../../../design'
import { IconChevronRight, IconMan, IconPlus, IconUsersGroup, IconWoman } from '../../../vendor/tablerIcons'
import { DirectorStoreContext } from '../../../workbench/generationCanvas/nodes/director/DirectorEditorContext'
import { createDirectorStore, type DirectorStore } from '../../../workbench/generationCanvas/nodes/director/model/directorStore'
import type { DirectorObject } from '../../../workbench/generationCanvas/nodes/director/model/directorTypes'
import { CreationModeContext, type CreationModeApi } from '../../../workbench/generationCanvas/nodes/director/panels/CreationModeContext'
import { ViewportApiContext, type ViewportApiRef } from '../../../workbench/generationCanvas/nodes/director/scene/ViewportApiContext'
import { AddObjectMenu } from '../../../workbench/generationCanvas/nodes/director/panels/topbar/AddObjectMenu'
import { Popover, PopoverItem } from '../../../workbench/generationCanvas/nodes/director/panels/Popover'
import { SliderNumberField } from '../../../workbench/generationCanvas/nodes/director/panels/fields/SliderNumberField'
import { SceneObjectsTab } from '../../../workbench/generationCanvas/nodes/director/panels/side/SceneObjectsTab'
import { ContextCard } from '../../../workbench/generationCanvas/nodes/director/panels/context/ContextCard'
import { CHARACTER_MODEL_BY_GENDER } from '../../../workbench/generationCanvas/nodes/director/scene/creation/useCharacterPlacement'

import { DIRECTOR_CROWD_CELL_HEIGHT, DIRECTOR_CROWD_CELL_WIDTH } from './directorCrowdConstants'

export type CrowdCell =
  | 'now-add-menu-character'
  | 'now-crowd-card'
  | 'new-add-menu-character'
  | 'new-crowd-panel'
  | 'after-one-group'
  | 'after-n-independent'

type Copy = {
  crowd: string
  place: string
  hint: string
  groupName: string
  singleName: (n: number) => string
  woman: string
  stage: Record<CrowdCell, string>
}

/** 提案态才有的文案（产品里还没有；用户拍板后进 i18n）。 */
const COPY: Record<AppLocale, Copy> = {
  'zh-CN': {
    crowd: '群众',
    place: '放置群众',
    hint: '点地面放下，行列中心落在点击处',
    groupName: '群众组',
    singleName: (n) => `群众 ${n}`,
    woman: '女人 1',
    stage: {
      'now-add-menu-character': '现状 · 顶栏「＋」→「角色」：只有女人 / 男人，没有群众',
      'now-crowd-card': '现状 · 群众藏在「先选中一个角色 → 基础页最底」的独立卡里',
      'new-add-menu-character': '提案 · 「＋」→「角色」多一项「群众」',
      'new-crowd-panel': '提案 · 选「群众」后同一个浮层里展开行 / 列 / 间距，主按钮在底、占满一行',
      'after-one-group': '提案 A · 加进场景后是一个「群众组」：大纲一行，点它整体选中，右卡改整体位置',
      'after-n-independent': '提案 B · 加进场景后是 N 个独立角色：大纲 N 行，要整体动得先多选',
    },
  },
  en: {
    crowd: 'Crowd',
    place: 'Place crowd',
    hint: 'Click the ground to drop it; the grid centres on the click',
    groupName: 'Crowd group',
    singleName: (n) => `Crowd ${n}`,
    woman: 'Woman 1',
    stage: {
      'now-add-menu-character': 'Now · top bar "+" → "Character": only Woman / Man, no crowd',
      'now-crowd-card': "Now · the crowd sits in a separate card at the bottom of a selected character's Basics page",
      'new-add-menu-character': 'Proposal · "+" → "Character" gains a "Crowd" item',
      'new-crowd-panel': 'Proposal · choosing "Crowd" expands rows / columns / spacing in the same popover; primary button full width at the bottom',
      'after-one-group': 'Proposal A · lands as one crowd group: one outliner row, click selects it whole, the card moves it as one',
      'after-n-independent': 'Proposal B · lands as N independent characters: N outliner rows, multi-select first to move together',
    },
  },
}

function useLocale(locale: AppLocale): void {
  React.useMemo(() => {
    void i18n.changeLanguage(locale)
  }, [locale])
}

type AddInput = Parameters<ReturnType<DirectorStore['getState']>['addObject']>[0]

function characterInput(name: string, x = 0, z = 0): AddInput {
  const spec = CHARACTER_MODEL_BY_GENDER.female
  return {
    name,
    type: 'character',
    position: { x, y: 0, z },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#fb7185',
    visible: true,
    locked: false,
    posePreset: 'tpose',
    modelPath: spec.modelPath,
    modelScale: 1,
    isSystemModel: true,
    rig: spec.rig,
  }
}

function makeStore(build: (store: DirectorStore) => void): DirectorStore {
  const store = createDirectorStore({ defaultSceneName: i18n.t('director.node.sceneDefaultName') })
  build(store)
  return store
}

const NOOP = (): void => undefined
const NO_POINTER = (): boolean => false
const CREATION = {
  placement: { active: false, gender: null, headingDeg: 0, ghostRef: { current: null }, start: NOOP, cancel: NOOP, onPointerDown: NO_POINTER, onPointerMove: NO_POINTER, onPointerUp: NO_POINTER, onPointerLeave: NOOP },
  boxDraw: { active: false, step: 'idle', dimensions: { width: 1, depth: 1, height: 1 }, ghostRef: { current: null }, start: NOOP, cancel: NOOP, onPointerDown: NO_POINTER, onPointerMove: NO_POINTER, onPointerUp: NO_POINTER },
} as unknown as CreationModeApi

function Frame({ cell, locale, children }: { cell: CrowdCell; locale: AppLocale; children: React.ReactNode }): JSX.Element {
  return (
    <div className="relative overflow-hidden rounded-nomi border border-nomi-line bg-nomi-bg" style={{ width: DIRECTOR_CROWD_CELL_WIDTH, height: DIRECTOR_CROWD_CELL_HEIGHT }} data-design-lab-stage="director-crowd">
      <div className="absolute inset-x-0 top-0 z-[1] border-b border-nomi-line bg-nomi-paper px-3 py-2 text-caption font-semibold text-nomi-ink-80">{COPY[locale].stage[cell]}</div>
      <div className="absolute inset-x-0 bottom-0 top-9">{children}</div>
    </div>
  )
}

/** 顶栏的一小段：只放真「＋」钮（其余顶栏件与本格无关）。 */
function TopBarStub({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-12 items-center gap-2 border-b border-nomi-line bg-nomi-paper px-3">{children}</div>
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** 走真按钮：先点「＋」，再点浮层里的「角色」（现役 AddObjectMenu 的 data-testid / 文案）。 */
async function openCharacterSubmenu(label: string): Promise<void> {
  const find = (): HTMLElement | undefined => document.querySelector<HTMLElement>('[data-testid="director-add-menu"]') ?? undefined
  for (let tries = 0; tries < 300 && !find(); tries += 1) await nextFrame()
  find()?.click()
  for (let tries = 0; tries < 300; tries += 1) {
    const item = [...document.querySelectorAll<HTMLElement>('[data-nomi-escape-layer="director-popover"] button')].find((button) => button.textContent?.includes(label))
    if (item) {
      item.click()
      return
    }
    await nextFrame()
  }
}

function NowAddMenu({ locale }: { locale: AppLocale }): JSX.Element {
  useLocale(locale)
  const store = React.useMemo(() => makeStore(NOOP), [])
  const viewportRef = React.useRef(null) as ViewportApiRef
  React.useEffect(() => {
    void openCharacterSubmenu(i18n.t('director.creation.character'))
  }, [])
  return (
    <DirectorStoreContext.Provider value={store}>
      <CreationModeContext.Provider value={CREATION}>
        <ViewportApiContext.Provider value={viewportRef}>
          <TopBarStub>
            <AddObjectMenu onOpenAssets={NOOP} />
          </TopBarStub>
        </ViewportApiContext.Provider>
      </CreationModeContext.Provider>
    </DirectorStoreContext.Provider>
  )
}

function RightCard({ store, selectId }: { store: DirectorStore; selectId: string }): JSX.Element {
  React.useMemo(() => store.getState().select({ objectId: selectId, multiObjectIds: [selectId] }), [store, selectId])
  return (
    <DirectorStoreContext.Provider value={store}>
      <div className="relative h-full w-full">
        <ContextCard sceneSettingsOpen={false} onCloseSceneSettings={NOOP} onCancelCreation={NOOP} />
      </div>
    </DirectorStoreContext.Provider>
  )
}

function NowCrowdCard({ locale }: { locale: AppLocale }): JSX.Element {
  useLocale(locale)
  const built = React.useMemo(() => {
    let id = ''
    const store = makeStore((s) => {
      id = s.getState().addObject(characterInput(COPY[locale].woman))
    })
    return { store, id }
  }, [locale])
  const ref = React.useRef<HTMLDivElement>(null)
  // 群众卡在基础页底部：把卡滚进视野（真滚动容器，不改任何状态）
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.querySelector('[data-testid="director-crowd-confirm"]')?.scrollIntoView({ block: 'end' }))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div ref={ref} className="h-full w-full">
      <RightCard store={built.store} selectId={built.id} />
    </div>
  )
}

/** 提案：「角色」子菜单 + 群众。项目与现役 AddObjectMenu「角色」子菜单原样一致，多一项「群众」。 */
function NewAddMenu({ locale, expanded }: { locale: AppLocale; expanded: boolean }): JSX.Element {
  useLocale(locale)
  const copy = COPY[locale]
  const [open, setOpen] = React.useState(true)
  const [rows, setRows] = React.useState(2)
  const [cols, setCols] = React.useState(3)
  const [spacing, setSpacing] = React.useState(2)
  const t = (key: string): string => i18n.t(key)
  return (
    <TopBarStub>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        panelClassName={expanded ? 'w-[292px] max-h-[420px] overflow-auto' : 'w-[228px] max-h-[420px] overflow-auto'}
        trigger={
          <WorkbenchIconButton
            size="sm"
            icon={<IconPlus size={16} stroke={1.9} />}
            label={t('director.topbar.addAria')}
            className="bg-nomi-accent-soft text-nomi-accent"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          />
        }
      >
        {expanded ? (
          <>
            <PopoverItem onClick={NOOP}>← {copy.crowd}</PopoverItem>
            <div className="mx-1 my-1 h-px bg-nomi-line-soft" />
            <div className="px-1 pt-1">
              <SliderNumberField label={t('director.bottomBar.crowdRows')} value={rows} min={1} max={10} step={1} onChange={setRows} />
              <SliderNumberField label={t('director.bottomBar.crowdCols')} value={cols} min={1} max={10} step={1} onChange={setCols} />
              <SliderNumberField label={t('director.bottomBar.crowdSpacing')} value={spacing} min={0.5} max={5} step={0.1} unit="m" onChange={setSpacing} />
              <div className="mb-2 text-micro text-nomi-ink-40">{copy.hint}</div>
              <WorkbenchButton size="sm" variant="primary" className="w-full" data-testid="director-crowd-place">{copy.place}</WorkbenchButton>
            </div>
          </>
        ) : (
          <>
            <PopoverItem onClick={NOOP}>← {t('director.creation.character')}</PopoverItem>
            <div className="mx-1 my-1 h-px bg-nomi-line-soft" />
            <PopoverItem onClick={NOOP}>
              <IconWoman size={16} stroke={1.9} />
              {t('director.creation.female')}
            </PopoverItem>
            <PopoverItem onClick={NOOP}>
              <IconMan size={16} stroke={1.9} />
              {t('director.creation.male')}
            </PopoverItem>
            <PopoverItem onClick={NOOP}>
              <IconUsersGroup size={16} stroke={1.9} />
              <span className="flex-1 text-left">{copy.crowd}</span>
              <IconChevronRight size={14} stroke={1.9} className="text-nomi-ink-40" />
            </PopoverItem>
          </>
        )}
      </Popover>
    </TopBarStub>
  )
}

/** 加进场景之后：大纲（现役 SceneObjectsTab）+ 右卡（现役 ContextCard）。 */
function AfterScene({ locale, mode }: { locale: AppLocale; mode: 'one-group' | 'n-independent' }): JSX.Element {
  useLocale(locale)
  const copy = COPY[locale]
  const built = React.useMemo(() => {
    let selectId = ''
    const store = makeStore((s) => {
      const state = s.getState()
      if (mode === 'one-group') {
        // 真动作：模板角色 → 现役 batchCreateCrowd 建组 → 删掉模板（提案里没有「先有一个角色」这一步）
        const template = state.addObject(characterInput('tmp'))
        const group = s.getState().batchCreateCrowd(template, 2, 3, 2, copy.groupName) ?? ''
        s.getState().deleteObject(template)
        const members = s.getState().activeScene().objects.filter((item: DirectorObject) => item.parentId === group)
        members.forEach((member: DirectorObject, index: number) => s.getState().renameObject(member.id, copy.singleName(index + 1)))
        selectId = group
        s.getState().select({ objectId: group, multiObjectIds: [group] })
      } else {
        const ids: string[] = []
        for (let row = 0; row < 2; row += 1) {
          for (let col = 0; col < 3; col += 1) ids.push(s.getState().addObject(characterInput(copy.singleName(ids.length + 1), (col - 1) * 2, (row - 0.5) * 2)))
        }
        selectId = ids[0] ?? ''
        s.getState().select({ objectId: ids[0], multiObjectIds: ids })
      }
    })
    return { store, selectId }
  }, [copy, mode])
  return (
    <DirectorStoreContext.Provider value={built.store}>
      <div className="flex h-full">
        <div className="w-[300px] shrink-0 overflow-auto border-r border-nomi-line bg-nomi-paper">
          <SceneObjectsTab />
        </div>
        <div className="relative min-w-0 flex-1">{mode === 'one-group' ? <RightCard store={built.store} selectId={built.selectId} /> : null}</div>
      </div>
    </DirectorStoreContext.Provider>
  )
}

export function DirectorCrowdStage({ cell, locale, release }: { cell: CrowdCell; locale: AppLocale; release: () => void }): JSX.Element {
  useLocale(locale)
  React.useEffect(() => {
    // 真按钮点击 / portal 定位都在挂载后几帧内落定：数帧后释放就绪持有
    let frames = 0
    let raf = 0
    const tick = () => {
      frames += 1
      if (frames < 60) raf = requestAnimationFrame(tick)
      else release()
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      release()
    }
  }, [release])
  return (
    <Frame cell={cell} locale={locale}>
      {cell === 'now-add-menu-character' ? <NowAddMenu locale={locale} /> : null}
      {cell === 'now-crowd-card' ? <NowCrowdCard locale={locale} /> : null}
      {cell === 'new-add-menu-character' ? <NewAddMenu locale={locale} expanded={false} /> : null}
      {cell === 'new-crowd-panel' ? <NewAddMenu locale={locale} expanded /> : null}
      {cell === 'after-one-group' ? <AfterScene locale={locale} mode="one-group" /> : null}
      {cell === 'after-n-independent' ? <AfterScene locale={locale} mode="n-independent" /> : null}
    </Frame>
  )
}
