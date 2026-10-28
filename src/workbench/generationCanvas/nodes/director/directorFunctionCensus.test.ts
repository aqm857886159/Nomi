/**
 * 旧导演台功能普查 22 项逐项钉住（用户 10-16：3D-BOX 是唯一的导演台，「功能完全一致、还优化了交互」）。
 *
 * 普查正本在拍板清单 `docs/design/boards/2026-10-16/Director3dbox.board.json` 的 functionCensus：每项「旧功能 → 新去处」。
 * 这里每项一条探针：能在节点环境里真跑的就真跑（Agent / MCP 建导演节点、编辑器 store 载入工程、快捷键表），
 * 只能看接线的就看现役组件树里它挂在哪（导演视图 / 精修两个面都由 DirectorEditor 无条件渲染，没有开关分支）。
 * 清单里多一项没有探针、或探针对不上清单 = 红；改设计丢了功能 = 红。
 * 板上认领的提示（notice.*，协调 10-24 定，同 #1300 口径）：copy 的键就是产品词典键，原文逐字等于词典那句——词典改了板没跟、或反过来，都在这里红。
 * 方向检查：docs/plan/2026-10-16-director-3dbox-sole-director-direction-check.md。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import board from '../../../../../docs/design/boards/2026-10-16/Director3dbox.board.json'
import candidatesDoc from '../../../../../docs/design/boards/2026-10-16/Director3dbox.candidates.json'
import { checkBoardManifest, loadAssertionCorpus } from '../../../../../scripts/check-board-parity.mjs'
import { resources } from '../../../../i18n/resources'
import { MODEL_FACING_TOOL_SPECS } from '../../../../../electron/shared/agentCapabilities/modelFacingToolRegistry'
import { applyCanvasToolCall, resetClientIdRegistry } from '../../agent/applyCanvasToolCall'
import { applyProposalBatch } from '../../agent/proposalTxn'
import { generationCanvasTools } from '../../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { DIRECTOR_HOTKEYS } from './model/hotkeys'
import { createDirectorStore } from './model/directorStore'
import { DIRECTOR_PLAN_META_KEY, DIRECTOR_PROJECT_META_KEY } from './model/directorNodeMeta'
import { createDirectorEditorPersistence } from './directorEditorPersistence'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string): string => fs.readFileSync(path.join(here, relative), 'utf8')
const exists = (relative: string): boolean => fs.existsSync(path.join(here, relative))

const EDITOR = read('DirectorEditor.tsx')
const VIEW = read('DirectorViewShell.tsx')
const REFINE = read('DirectorRefineShell.tsx')
const TOPBAR = read('panels/topbar/RefineTopBar.tsx')

/** 编辑器层（两个面共用）挂着它：在 EditorBody 里、不在任何一个面的壳里。 */
const editorBody = EDITOR.slice(EDITOR.indexOf('function EditorBody('), EDITOR.indexOf('export default'))

const directorNodes = () => useGenerationCanvasStore.getState().nodes.filter((node) => node.kind === 'director')

function loadsInEditor(meta: Record<string, unknown> | undefined): number {
  const store = createDirectorStore({ rawProject: meta?.[DIRECTOR_PROJECT_META_KEY], defaultSceneName: 'scene' })
  const scene = store.getState().activeScene()
  return scene.objects.length + scene.cameras.length
}

const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [{ id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
}

/** [普查项 function 的开头, 探针]。顺序与清单一致。 */
const PROBES: ReadonlyArray<readonly [string, () => void | Promise<void>]> = [
  ['退出 / 返回画布', () => {
    expect(VIEW).toContain('<ExitButton onExit={onExit} />')
    expect(TOPBAR).toContain('<ExitButton onExit={onExit} />')
    expect(EDITOR).toMatch(/const handleExit = [\s\S]*?confirmDialog\([\s\S]*?persistence\.saveNow\(\)/)
    expect(typeof createDirectorEditorPersistence).toBe('function')
  }],
  ['打开导演台默认进入全套编辑器', () => {
    expect(editorBody).toContain("React.useState<DirectorViewMode>('director')")
    expect(VIEW).toContain('<ViewModeSwitch mode="director" onChange={onViewModeChange}')
    expect(TOPBAR).toContain('<ViewModeSwitch mode={viewMode.value} onChange={viewMode.onChange}')
    expect(EDITOR).toContain("if (viewMode === 'director') {")
    expect(EDITOR).toContain('<DirectorRefineShell')
  }],
  // 条目名对着拍板板（Director3dbox.board.json）里「导演台盖住整个窗口（全屏覆盖层）→ 改为占画布区、右侧 Agent 面板可见」那一行，前缀不能改。
  // 这条的探针原来断言「right: assistantCollapsed ? 0 : assistantPaneWidth(…)」——那正是浮窗时右边漏画布、点创作出不去的来路（2026-10-29）。
  // 现在「占画布区」落成：生成页里的一块——DirectorNode 经 GenerationPageLayer 挂进画布那一格，根 size-full，版面归网格（Agent 停靠栏在网格第 2 列，天然让开）。
  ['导演台盖住整个窗口', () => {
    expect(read('DirectorNode.tsx')).toContain('<GenerationPageLayer>')
    expect(EDITOR).toContain('size-full')
    expect(EDITOR).toContain('useGenerationPageLayerActive')
    expect(EDITOR).not.toContain('assistantPaneWidth')
    expect(EDITOR).not.toContain('projectAgentDockCollapsed')
  }],
  ['场景 ▾', () => {
    expect(TOPBAR).toContain('<SceneMenu onOpenSceneSettings={onOpenSceneSettings}')
    expect(read('panels/topbar/SceneMenu.tsx')).toContain('SceneObjectsTab')
  }],
  ['工具：选择 / 移动 / 旋转 / 缩放', () => {
    expect([DIRECTOR_HOTKEYS.select.key, DIRECTOR_HOTKEYS.translate.key, DIRECTOR_HOTKEYS.rotate.key, DIRECTOR_HOTKEYS.scale.key]).toEqual(['Escape', '1', '2', '3'])
    expect(TOPBAR).toContain('<ViewportToolbar onCancelCreation={onCancelCreation} />')
    expect(editorBody).toContain('useDirectorHotkeys({')
  }],
  ['画线 / 逐点路标', () => {
    expect([DIRECTOR_HOTKEYS.drawPencil.key, DIRECTOR_HOTKEYS.waypoint.key]).toEqual(['4', '5'])
    const card = read('panels/context/ContextCard.tsx')
    expect(card).toContain('IconPencil')
    expect(card).toContain('IconRoute')
  }],
  ['＋ 添加', () => {
    expect(TOPBAR).toContain('<AddObjectMenu onOpenAssets={onOpenAssets} />')
    const menu = read('panels/topbar/AddObjectMenu.tsx')
    for (const token of ["'crowd'", "'camera'", "'light'", 'boxDraw', 'usePanoramaImport', 'onOpenAssets']) expect(menu).toContain(token)
    expect(REFINE).toContain('<AssetsDrawer onClose={closeAssets} />')
  }],
  ['视图 ▾', () => {
    expect(TOPBAR).toContain('<ViewMenu onResetView={onResetView} onOpenSettings={onOpenSettings} onOpenHelp={onOpenHelp} />')
    expect(DIRECTOR_HOTKEYS.resetCamera.key).toBe('0')
  }],
  ['撤销 / 重做', () => {
    expect(VIEW).toContain('<HistoryButtons />')
    expect(TOPBAR).toContain('<HistoryButtons />')
    expect(DIRECTOR_HOTKEYS.undo).toMatchObject({ key: 'z', meta: true })
    expect(DIRECTOR_HOTKEYS.redo).toMatchObject({ key: 'z', meta: true, shift: true })
  }],
  ['截图', () => {
    expect(DIRECTOR_HOTKEYS.screenshot).toMatchObject({ key: 'p', meta: true, shift: true })
    expect(editorBody).toContain('screenshot: () => {')
    expect(TOPBAR).toContain('IconCamera')
  }],
  ['产出：录制 MP4', () => {
    expect(TOPBAR).toContain('<OutputsPopover />')
    expect(editorBody).toContain('<OutputsContext.Provider value={outputs}>')
  }],
  ['选中才出的属性卡', () => {
    expect(REFINE).toContain('<ContextCard sceneSettingsOpen={sceneSettingsOpen}')
    const inspector = read('panels/inspector/ContextInspector.tsx')
    for (const name of ['CameraInspector', 'CharacterInspector', 'LightInspector', 'PrimitiveInspector', 'useTimelineSelectionCard']) expect(inspector).toContain(name)
  }],
  ['小窗', () => {
    expect(read('panels/viewport/DirectorViewport.tsx')).toContain('<PipViewport ')
    expect(VIEW).toContain('<DirectorViewport')
    expect(REFINE).toContain('<DirectorViewport')
  }],
  ['关键帧时间轴', () => {
    expect(REFINE).toContain('<DirectorTimeline collapsed={timelineCollapsed}')
  }],
  ['播放 / 暂停（空格）', () => {
    expect(DIRECTOR_HOTKEYS.togglePlay.key).toBe(' ')
    expect(read('panels/shotStrip/DirectorShotStrip.tsx')).toContain('onClick={() => togglePlay(store)}')
    expect(VIEW).toContain('<DirectorShotStrip ')
  }],
  ['其余快捷键', () => {
    // 删旧导演台那天（2026-10-16）键位表的全部 32 个动作；只增不减，少一个就是改设计丢了功能。
    expect(Object.keys(DIRECTOR_HOTKEYS)).toEqual(expect.arrayContaining([
      'select', 'translate', 'rotate', 'scale', 'drawPencil', 'waypoint', 'resetCamera', 'focusEntity', 'insertKeyframe', 'screenshot',
      'captureCamera', 'recordMotion', 'ikMode', 'fkMode', 'group', 'ungroup', 'undo', 'redo', 'copy', 'paste', 'pasteBackward',
      'deleteSelection', 'cutLeft', 'cutRight', 'splitClip', 'prevFrame', 'nextFrame', 'prev10Frames', 'next10Frames',
      'prevSplitPoint', 'nextSplitPoint', 'togglePlay',
    ]))
    expect(editorBody).toContain('useDirectorHotkeys({')
    expect(VIEW).not.toContain('useDirectorHotkeys')
    expect(REFINE).not.toContain('useDirectorHotkeys')
  }],
  ['手机虚拟相机（连接对话框）', () => {
    expect(editorBody).toContain('<MobileConnectDialog />')
    expect(editorBody).toContain('<MobileCameraContext.Provider value={mobile}>')
  }],
  ['设置 / 帮助对话框', () => {
    expect(editorBody).toContain('<SettingsDialog')
    expect(editorBody).toContain('<HelpDialog open={helpOpen}')
  }],
  ['视口底部「描述场景…」', () => {
    // 胶囊随旧导演台删除；一句话搭场景的去处是右侧 Agent 的 stage_shot（director.write）。
    expect(exists('panels/ai/AiSceneBar.tsx')).toBe(false)
    expect(exists('useAiSceneBuilder.ts')).toBe(false)
    expect(MODEL_FACING_TOOL_SPECS.filter((spec) => spec.name === 'stage_shot').map((spec) => spec.contractId)).toEqual(['director.write'])
  }],
  ['Agent 旧 stage_shot', async () => {
    const [shot] = generationCanvasTools.create_nodes([{ kind: 'video', title: 'shot-a', prompt: 'p', position: { x: 0, y: 0 } }])
    const outcome = await applyProposalBatch([{ toolCallId: 'c1', toolName: 'create_director_plan', effectiveArgs: { operation: 'create_director_plan', shotNodeId: shot.id, plan: PLAN } as unknown as Record<string, unknown> }])
    expect(outcome.status).toBe('committed')
    const [director] = directorNodes()
    expect(director?.meta?.[DIRECTOR_PLAN_META_KEY]).toBeTruthy()
    expect(loadsInEditor(director?.meta)).toBeGreaterThan(0)
  }],
  ['已有工程里的旧「摆位参考 / 运镜参考」导演节点', async () => {
    // 旧节点 = 旧 stage_shot 建的那种：工程是旧摆位构建器经读时迁移出来的，没有计划 meta。照常载入编辑器。
    await applyCanvasToolCall('create_canvas_nodes', { nodes: [{ clientId: 'k1', kind: 'image', title: '关键帧', prompt: 'p' }] })
    await applyCanvasToolCall('create_staging_reference', { shotClientId: 'k1', characters: [{ name: 'A' }, { name: 'B' }], layout: 'facing' })
    const [director] = directorNodes()
    expect(director?.meta?.[DIRECTOR_PLAN_META_KEY]).toBeUndefined()
    expect(loadsInEditor(director?.meta)).toBeGreaterThan(0)
  }],
  ['对外 MCP 工具 nomi_canvas_edit', async () => {
    // MCP 的两个操作走的就是这条渲染端执行体（canvas.write）；建出来的导演节点在唯一的 3D-BOX 导演台里打开。
    await applyCanvasToolCall('create_canvas_nodes', { nodes: [{ clientId: 'v1', kind: 'video', title: '镜头 1', prompt: 'p' }] })
    const result = (await applyCanvasToolCall('create_camera_move', { shotClientId: 'v1', move: 'push_in' })) as { cameraMoveNodeId: string | null }
    const director = directorNodes().find((node) => node.id === result.cameraMoveNodeId)
    expect(director).toBeTruthy()
    expect(loadsInEditor(director?.meta)).toBeGreaterThan(0)
    expect(read('DirectorNode.tsx')).toContain('DirectorEditor')
  }],
]

const census = board.functionCensus as ReadonlyArray<{ function: string; after: string }>

beforeEach(() => {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
  resetClientIdRegistry()
})

describe('old director function census: every item still has a working home in the sole 3D-BOX director', () => {
  it('pairs every census item with exactly one probe and every probe with exactly one item', () => {
    expect(census).toHaveLength(22)
    for (const item of census) expect(PROBES.filter(([prefix]) => item.function.startsWith(prefix)).map(([prefix]) => prefix), item.function).toHaveLength(1)
    for (const [prefix] of PROBES) expect(census.filter((item) => item.function.startsWith(prefix)).length, prefix).toBe(1)
  })

  it('the board manifest itself is consistent (every census item lands on an element, dropped items carry the user quote, implemented items name a real walk assertion)', () => {
    expect(checkBoardManifest({ board: 'Director3dbox', manifest: board, candidates: candidatesDoc.candidates, assertionCorpus: loadAssertionCorpus() })).toEqual([])
  })

  it('notices claimed on the board carry the dictionary copy word for word (zh-CN and en)', () => {
    const notices = (board.elements as ReadonlyArray<{ id: string; copy?: Record<string, Record<string, string>> }>).filter((element) => element.id.startsWith('notice.'))
    expect(notices.map((element) => element.id)).toEqual(['notice.staging-attach', 'notice.camera-move-attach'])
    for (const notice of notices) {
      for (const [key, text] of Object.entries(notice.copy ?? {})) {
        for (const locale of ['zh-CN', 'en'] as const) {
          const dictionary = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], resources[locale].translation)
          expect(text[locale], `${notice.id} · ${key} · ${locale}`).toBe(dictionary)
        }
      }
    }
  })

  it('no director code path branches on a build flag any more', () => {
    for (const source of [EDITOR, VIEW, REFINE, TOPBAR]) expect(source).not.toMatch(/featureFlags|director3dbox(Face|Enabled)|isDirector3DBox/)
  })

  it.each(PROBES.map(([prefix, probe]) => [prefix, probe] as const))('%s', async (_prefix, probe) => {
    await probe()
  })
})
