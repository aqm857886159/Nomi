import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkbenchStore } from '../workbenchStore'
import { readCurrentWorkbenchProjectPayload } from '../project/workbenchProjectSession'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS } from './panelLayout'
import { displayEditingPanelLayout, LAYOUT_ACTION_LAYERS } from './editingPanelLayoutSlice'

/**
 * 常驻 Nomi 栏的开合**跟机器走**（用户 2026-11-13 拍板；2026-09-06 的「默认展开 + 记住上次」不变，只是改由
 * 这台机器每页的形态偏好记住）。项目文件里的 `editingPanelLayout.visibility.assistant` 保留、老版本照读，
 * 但界面上的任何动作都不再改写它；`projectAgentDockCollapsed` 是显示态，改它不让项目落盘。
 * 复盘：docs/engineering/direction-checks/2026-11-13-open-writes-project.md。
 */
describe('Nomi 栏开合：显示态不让项目落盘', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      editingPanelUndoStack: [],
      projectAgentDockCollapsed: false,
    })
  })

  it('默认展开（没有存过偏好时）', () => {
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(false)
    expect(EDITING_PANEL_DEFAULTS.visibility.assistant).toBe(true)
  })

  it('收起 / 展开（外壳同步、任务中心叫回、交给 Agent）只改显示态：不 bump，落盘物里还是项目原值', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(true)
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev)
    expect(readCurrentWorkbenchProjectPayload().editingPanelLayout?.visibility.assistant).toBe(true)
    expect(displayEditingPanelLayout(useWorkbenchStore.getState()).visibility.assistant).toBe(false)
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(false)
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev)
  })

  it('打开项目时还原落盘布局：显示态先跟项目原值对齐，不 bump（还原不是编辑）', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    const saved = { ...cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), visibility: { source: true, inspector: true, assistant: false } }
    useWorkbenchStore.getState().setEditingPanelLayout(saved, false)
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(true)
    expect(useWorkbenchStore.getState().editingPanelLayout.visibility.assistant).toBe(false)
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev)
  })

  it('布局菜单翻 Nomi：显示态跟着翻；落盘那份只记 preset 变 custom，Nomi 开合不动', () => {
    useWorkbenchStore.getState().toggleEditingPanel('assistant')
    const state = useWorkbenchStore.getState()
    expect(state.projectAgentDockCollapsed).toBe(true)
    expect(state.editingPanelLayout.visibility.assistant).toBe(true)
    expect(state.editingPanelLayout.preset).toBe('custom')
  })

  it('Agent layout.write 只写 Nomi 开合：显示态变，落盘那份的开合不变', () => {
    useWorkbenchStore.getState().writeEditingPanelLayoutFromAgent({ visibility: { assistant: false }, preset: 'default' })
    const state = useWorkbenchStore.getState()
    expect(state.projectAgentDockCollapsed).toBe(true)
    expect(state.editingPanelLayout.visibility.assistant).toBe(true)
  })

  it('拖出来的栏宽照旧 bump（同一份落盘物，无改动时不 bump）', () => {
    const rev = useWorkbenchStore.getState().persistRevision
    const width = useWorkbenchStore.getState().editingPanelLayout.assistantWidth
    useWorkbenchStore.getState().syncEditingPanelSize({ assistantWidth: width + 20 })
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev + 1)
    useWorkbenchStore.getState().syncEditingPanelSize({ assistantWidth: width + 20 })
    expect(useWorkbenchStore.getState().persistRevision).toBe(rev + 1)
  })
})

/**
 * 「显示值进不了落盘对象」：任意动作序列之后，落盘用的那份 visibility.assistant 等于打开项目时读到的值
 * （新项目 = 默认值）。动作表就是布局登记表里的全部动作——登记表多一个动作，这里也得多一个。
 */
describe('任意动作序列之后，项目里的 Nomi 栏开合 = 打开时读到的值', () => {
  type Store = ReturnType<typeof useWorkbenchStore.getState>
  const ACTIONS: Record<keyof typeof LAYOUT_ACTION_LAYERS, (store: Store, flip: boolean) => void> = {
    setProjectAgentDockCollapsed: (store, flip) => store.setProjectAgentDockCollapsed(flip),
    keepEditingPanel: (store, flip) => store.keepEditingPanel(flip ? 'inspector' : 'source'),
    setTimelineSnapEnabled: (store, flip) => store.setTimelineSnapEnabled(flip),
    openPreviewSourceTab: (store, flip) => store.openPreviewSourceTab(flip ? 'assets' : 'shots'),
    showEditingPanel: (store, flip) => store.showEditingPanel(flip ? 'assistant' : 'source', !flip),
    toggleEditingPanel: (store, flip) => store.toggleEditingPanel(flip ? 'assistant' : 'inspector'),
    setEditingPanelLayout: (store, flip) => store.setEditingPanelLayout({ visibility: { assistant: flip, source: !flip } }),
    writeEditingPanelLayoutFromAgent: (store, flip) => store.writeEditingPanelLayoutFromAgent({ ...displayEditingPanelLayout(store), visibility: { source: flip, inspector: true, assistant: !flip } }),
    setEditingPanelPreset: (store, flip) => store.setEditingPanelPreset(flip ? 'result' : 'focus'),
    resetEditingPanelLayout: (store) => store.resetEditingPanelLayout(),
    undoEditingPanelLayout: (store) => { store.undoEditingPanelLayout() },
    syncEditingPanelSize: (store, flip) => store.syncEditingPanelSize({ assistantWidth: flip ? 420 : 380, sourceWidth: flip ? 300 : 320 }),
    markEditingPanelLayoutCustom: (store) => store.markEditingPanelLayoutCustom(),
  }
  const names = Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>

  // 小而确定的伪随机（不引新依赖）：同一个种子每次同一串动作，红了能复现。
  const random = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

  for (const opened of [true, false, 'new-project'] as const) {
    it(`打开时 = ${String(opened)}：200 串 × 30 步动作后，落盘物里的开合不变`, () => {
      for (let run = 0; run < 200; run += 1) {
        useWorkbenchStore.setState({ editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), editingPanelUndoStack: [], projectAgentDockCollapsed: false })
        const expected = opened === 'new-project' ? EDITING_PANEL_DEFAULTS.visibility.assistant : opened
        if (opened !== 'new-project') {
          useWorkbenchStore.getState().setEditingPanelLayout({ ...cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), visibility: { source: true, inspector: true, assistant: opened } }, false)
        }
        const next = random(run + 1 + (opened === true ? 0 : opened === false ? 1000 : 2000))
        for (let step = 0; step < 30; step += 1) {
          const name = names[Math.floor(next() * names.length)]
          ACTIONS[name](useWorkbenchStore.getState(), next() < 0.5)
          expect(readCurrentWorkbenchProjectPayload().editingPanelLayout?.visibility.assistant, `${run}/${step} ${name}`).toBe(expected)
        }
      }
    })
  }
})

/**
 * 「叫回 Nomi」计数（agentRecallNonce）：外壳的 Agent 小球靠它决定要不要自己展开。
 * 事故（2026-10-09，评测 j5）：小球用户回项目库再重开项目，投影 `projectAgentDockCollapsed` 被「关项目重置」和「开项目还原」
 * 翻了一下，小球按翻转去猜，自己弹成浮窗盖住了生成钮。所以这三条钉死：还原 / 重置不计数，用户或 Agent 的动作才计数。
 */
describe('叫回 Nomi 的计数（别在重开项目时自己弹开）', () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS),
      editingPanelUndoStack: [],
      projectAgentDockCollapsed: false,
      agentRecallNonce: 0,
    })
  })

  it('收起 → 展开的动作（任务中心定位到制作 / 翻可见性）各计一次；展开着再展开、收起都不计', () => {
    const state = () => useWorkbenchStore.getState()
    state().setProjectAgentDockCollapsed(false)
    expect(state().agentRecallNonce).toBe(0)
    state().setProjectAgentDockCollapsed(true)
    expect(state().agentRecallNonce).toBe(0)
    state().setProjectAgentDockCollapsed(false)
    expect(state().agentRecallNonce).toBe(1)
    state().toggleEditingPanel('assistant')
    expect(state().agentRecallNonce).toBe(1)
    state().toggleEditingPanel('assistant')
    expect(state().agentRecallNonce).toBe(2)
  })

  it('打开项目时还原落盘布局（setEditingPanelLayout(…, false)）不计，哪怕投影因此从收起翻成展开', () => {
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    const before = useWorkbenchStore.getState().agentRecallNonce
    const saved = cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS)
    expect(saved.visibility.assistant).toBe(true)
    useWorkbenchStore.getState().setEditingPanelLayout(saved, false)
    expect(useWorkbenchStore.getState().projectAgentDockCollapsed).toBe(false)
    expect(useWorkbenchStore.getState().agentRecallNonce).toBe(before)
  })

  it('关项目时的整体重置（releaseProject 直接 setState）不计', () => {
    useWorkbenchStore.getState().setProjectAgentDockCollapsed(true)
    const before = useWorkbenchStore.getState().agentRecallNonce
    useWorkbenchStore.setState({ projectAgentDockCollapsed: false, editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS) })
    expect(useWorkbenchStore.getState().agentRecallNonce).toBe(before)
  })
})

/**
 * 布局这一片的落盘只有 commitLayout 一个口（编译期：它只收登记表里非 display 层的动作名）。
 * 这条在运行期补两处编译管不到的：登记表和切片的动作一一对应；切片源码里除了那个口，没有别处碰 persistRevision。
 */
describe('布局落盘登记表', () => {
  it('登记表里的每个名字都是切片上真实存在的动作', () => {
    const state = useWorkbenchStore.getState() as unknown as Record<string, unknown>
    for (const name of Object.keys(LAYOUT_ACTION_LAYERS)) expect(typeof state[name], name).toBe('function')
  })

  it('切片源码里只有 commitLayout 能写 persistRevision', () => {
    const source = readFileSync(fileURLToPath(new URL('./editingPanelLayoutSlice.ts', import.meta.url)), 'utf8')
    const code = source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line))
    const writers = code.filter((line) => /persistRevision\s*:/.test(line) && !/persistRevision:\s*number/.test(line))
    expect(writers).toEqual(['    ...(changed ? { persistRevision: state.persistRevision + 1 } : {}),'])
  })
})
