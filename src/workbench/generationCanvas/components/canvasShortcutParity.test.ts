// LibTV 快捷键对齐（docs/plan/2026-09-21-canvas-shortcut-parity.md）：
// 每个新键的分发、编辑器聚焦时不触发、⌘D 复制节点与内部边、⌘L 连线方向、帮助面板按平台派生字形。
import type { RefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGenerationNode } from '../model/graphOps'
import { getClipboard, setClipboard } from '../store/canvasClipboard'
import { __resetGenerationCanvasHistoryForTests, useGenerationCanvasStore } from '../store/generationCanvasStore'
import { canvasControlsHelpSections } from './canvasControlsHelpModel'
import { planSelectionConnection } from './canvasSelectionConnection'
import { canvasShortcutKey, createCanvasKeydownHandler, tabBelongsToCanvas } from './useCanvasShortcuts'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

afterEach(() => {
  __resetGenerationCanvasHistoryForTests()
  setClipboard(null)
  if (originalWindow === undefined) delete (globalThis as { window?: Window }).window
  else globalThis.window = originalWindow
  if (originalDocument === undefined) delete (globalThis as { document?: Document }).document
  else globalThis.document = originalDocument
})

const BODY = { matches: () => false } as unknown as Element

function element(interactive: boolean): Element {
  return { matches: () => interactive, closest: () => null } as unknown as Element
}

const EDITOR_ROOT = {}
const EDITOR = { closest: () => EDITOR_ROOT } as unknown as EventTarget
const CANVAS = { closest: () => null } as unknown as EventTarget

function installDom(activeElement: Element = BODY) {
  globalThis.window = { getSelection: () => ({ isCollapsed: true }) } as unknown as Window & typeof globalThis
  globalThis.document = { activeElement, body: BODY, querySelector: () => null } as unknown as Document
}

type KeyInit = { key: string; code?: string; meta?: boolean; alt?: boolean; shift?: boolean; composing?: boolean; target?: EventTarget }

function press(handler: (event: KeyboardEvent) => void, init: KeyInit): KeyboardEvent {
  const event = new Event('keydown', { cancelable: true })
  Object.defineProperties(event, {
    key: { value: init.key },
    code: { value: init.code ?? '' },
    metaKey: { value: Boolean(init.meta) },
    ctrlKey: { value: false },
    altKey: { value: Boolean(init.alt) },
    shiftKey: { value: Boolean(init.shift) },
    isComposing: { value: Boolean(init.composing) },
    target: { value: init.target ?? CANVAS },
  })
  handler(event as KeyboardEvent)
  return event as KeyboardEvent
}

function harness(selectedNodeCount: number) {
  const commands = {
    duplicateSelectedNodes: vi.fn(),
    connectSelectedNodes: vi.fn(),
    openAddNodeMenu: vi.fn(),
    tidyCanvas: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    groupSelectedNodes: vi.fn(),
    ungroupSelectedNodes: vi.fn(),
  }
  const handler = createCanvasKeydownHandler({
    stageRef: { current: { offsetParent: {} } } as RefObject<HTMLDivElement>,
    selectedNodeCount,
    selectedGroupCount: 0,
    activeCategoryId: 'shots',
    setActiveEdge: () => {},
    cancelConnection: () => {},
    deleteSelectedNodes: () => {},
    copySelectedNodes: () => {},
    cutSelectedNodes: () => {},
    pasteNodes: () => {},
    zoomByStep: () => {},
    ...commands,
  })
  return { handler, commands }
}

// 每一个新键：按什么、要几个选中、应该落到哪个命令。
const BINDINGS: Array<{ name: string; init: KeyInit; selected: number; command: keyof ReturnType<typeof harness>['commands'] }> = [
  { name: '⌘D 复制节点和连线', init: { key: 'd', code: 'KeyD', meta: true }, selected: 1, command: 'duplicateSelectedNodes' },
  { name: '⌘L 连线（选两个）', init: { key: 'l', code: 'KeyL', meta: true }, selected: 2, command: 'connectSelectedNodes' },
  { name: 'Tab 新建节点', init: { key: 'Tab', code: 'Tab' }, selected: 0, command: 'openAddNodeMenu' },
  // macOS 上 ⌥⇧F 的 event.key 是 Ï：只认 key 会在 Mac 上失灵。
  { name: '⌥⇧F 整理画布（Mac 字形 Ï）', init: { key: 'Ï', code: 'KeyF', alt: true, shift: true }, selected: 0, command: 'tidyCanvas' },
  { name: 'Alt+Shift+F 整理画布（Windows）', init: { key: 'F', code: 'KeyF', alt: true, shift: true }, selected: 0, command: 'tidyCanvas' },
]

describe('LibTV 对齐快捷键：分发', () => {
  for (const binding of BINDINGS) {
    it(`${binding.name} → ${binding.command}，并拦下浏览器默认行为`, () => {
      installDom()
      const { handler, commands } = harness(binding.selected)
      const event = press(handler, binding.init)
      expect(commands[binding.command]).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
      for (const [name, fn] of Object.entries(commands)) if (name !== binding.command) expect(fn, name).not.toHaveBeenCalled()
    })

    it(`${binding.name}：事件来自提示词编辑器时交还给编辑器`, () => {
      installDom(EDITOR as unknown as Element)
      const { handler, commands } = harness(binding.selected)
      const event = press(handler, { ...binding.init, target: EDITOR })
      expect(commands[binding.command]).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })

    it(`${binding.name}：输入法组字中不触发`, () => {
      installDom()
      const { handler, commands } = harness(binding.selected)
      press(handler, { ...binding.init, composing: true })
      expect(commands[binding.command]).not.toHaveBeenCalled()
    })
  }

  it('在编辑器里打 v / h / f / Tab：画布什么都不做', () => {
    installDom(EDITOR as unknown as Element)
    const { handler, commands } = harness(1)
    for (const key of ['v', 'h', 'f', 'Tab']) press(handler, { key, code: key === 'Tab' ? 'Tab' : `Key${key.toUpperCase()}`, target: EDITOR })
    for (const fn of Object.values(commands)) expect(fn).not.toHaveBeenCalled()
  })

  it('没有选中时 ⌘D / ⌘L 不动、也不吞键', () => {
    installDom()
    const { handler, commands } = harness(0)
    for (const init of [BINDINGS[0].init, BINDINGS[1].init]) expect(press(handler, init).defaultPrevented).toBe(false)
    expect(commands.duplicateSelectedNodes).not.toHaveBeenCalled()
    expect(commands.connectSelectedNodes).not.toHaveBeenCalled()
  })

  it('⌘Enter 不再有「生成所选」：批量只走组工具条，按了什么命令都不触发、也不吞键', () => {
    installDom()
    const { handler, commands } = harness(2)
    expect(press(handler, { key: 'Enter', code: 'Enter', meta: true }).defaultPrevented).toBe(false)
    for (const fn of Object.values(commands)) expect(fn).not.toHaveBeenCalled()
  })

  it('⌘L 只认「选中两个」：一个（没有收尾手势的待连态是死胡同）或三个（不猜连哪条）都不动', () => {
    installDom()
    for (const count of [1, 3]) {
      const { handler, commands } = harness(count)
      expect(press(handler, BINDINGS[1].init).defaultPrevented).toBe(false)
      expect(commands.connectSelectedNodes).not.toHaveBeenCalled()
    }
  })

  it('焦点在按钮 / 菜单项上时 Tab 仍是焦点切换', () => {
    installDom(element(true))
    const { handler, commands } = harness(0)
    const event = press(handler, { key: 'Tab', code: 'Tab' })
    expect(commands.openAddNodeMenu).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(tabBelongsToCanvas(element(false))).toBe(true)
  })

  it('Shift+Tab 不是新建（反向焦点切换）', () => {
    installDom()
    const { handler, commands } = harness(0)
    press(handler, { key: 'Tab', code: 'Tab', shift: true })
    expect(commands.openAddNodeMenu).not.toHaveBeenCalled()
  })

  it('既有键不受影响：⌘G / ⌘⇧G / ⌘Z / ⌘⇧Z（俄文布局按 code 回退）', () => {
    installDom()
    const { handler, commands } = harness(2)
    press(handler, { key: 'g', code: 'KeyG', meta: true })
    press(handler, { key: 'я', code: 'KeyZ', meta: true })
    press(handler, { key: 'Z', code: 'KeyZ', meta: true, shift: true })
    expect(commands.groupSelectedNodes).toHaveBeenCalledTimes(1)
    expect(commands.undo).toHaveBeenCalledTimes(1)
    expect(commands.redo).toHaveBeenCalledTimes(1)
  })

  it('字母判据：先认键帽上的字，非 ASCII 才回退物理位置', () => {
    expect(canvasShortcutKey({ key: 'd', code: 'KeyE' })).toBe('d') // Dvorak：键帽 d 在 QWERTY 的 E 位
    expect(canvasShortcutKey({ key: 'Ï', code: 'KeyF' })).toBe('f')
    expect(canvasShortcutKey({ key: 'Enter', code: 'Enter' })).toBe('enter')
  })
})

describe('⌘D：所选节点 + 它们之间的边原地复制', () => {
  it('只带选中节点之间的边、一次撤销回滚、不动用户剪贴板', () => {
    const a = { ...createGenerationNode({ id: 'a', kind: 'image' }), position: { x: 100, y: 100 } }
    const b = { ...createGenerationNode({ id: 'b', kind: 'video' }), position: { x: 500, y: 100 } }
    const outside = { ...createGenerationNode({ id: 'c', kind: 'image' }), position: { x: 900, y: 100 } }
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot({
      nodes: [a, b, outside],
      edges: [
        { id: 'edge-a-b', source: 'a', target: 'b' },
        { id: 'edge-b-c', source: 'b', target: 'c' },
      ],
      groups: [],
    })
    const userClipboard = { nodes: [outside], edges: [] }
    setClipboard(userClipboard)
    useGenerationCanvasStore.getState().selectNodes(['a', 'b'])

    useGenerationCanvasStore.getState().duplicateSelectedNodes()

    const after = useGenerationCanvasStore.getState()
    expect(after.nodes).toHaveLength(5)
    const copies = after.nodes.filter((node) => !['a', 'b', 'c'].includes(node.id))
    expect([...after.selectedNodeIds].sort()).toEqual(copies.map((node) => node.id).sort())
    const copyIds = new Set(copies.map((node) => node.id))
    const copiedEdges = after.edges.filter((edge) => copyIds.has(edge.source) || copyIds.has(edge.target))
    expect(copiedEdges).toHaveLength(1)
    expect(copyIds.has(copiedEdges[0].source) && copyIds.has(copiedEdges[0].target)).toBe(true)
    expect(copies.every((copy) => copy.position.x !== a.position.x || copy.position.y !== a.position.y)).toBe(true)
    expect(getClipboard()).toBe(userClipboard)

    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().nodes.map((node) => node.id).sort()).toEqual(['a', 'b', 'c'])
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(2)
  })

  it('没选中时什么都不做', () => {
    const store = useGenerationCanvasStore.getState()
    store.restoreSnapshot({ nodes: [createGenerationNode({ id: 'a', kind: 'image' })], edges: [], groups: [] })
    store.clearSelection()
    useGenerationCanvasStore.getState().duplicateSelectedNodes()
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
  })
})

describe('⌘L：连线方向', () => {
  const nodes = [
    { id: 'right', position: { x: 600, y: 0 } },
    { id: 'left', position: { x: 100, y: 300 } },
    { id: 'below', position: { x: 100, y: 700 } },
  ]
  it('选两个：左边连到右边，与选中顺序无关', () => {
    expect(planSelectionConnection(['right', 'left'], nodes)).toEqual({ sourceId: 'left', targetId: 'right' })
    expect(planSelectionConnection(['left', 'right'], nodes)).toEqual({ sourceId: 'left', targetId: 'right' })
  })
  it('同一列：上面的连到下面的', () => {
    expect(planSelectionConnection(['below', 'left'], nodes)).toEqual({ sourceId: 'left', targetId: 'below' })
  })
  it('不是两个就不连', () => {
    expect(planSelectionConnection(['left'], nodes)).toBeNull()
    expect(planSelectionConnection([], nodes)).toBeNull()
    expect(planSelectionConnection(['left', 'right', 'below'], nodes)).toBeNull()
  })
})

describe('帮助面板：新键都写进去，修饰键按平台派生', () => {
  const rowsOf = (platform: string) => canvasControlsHelpSections('wheel-zoom', platform).flatMap((section) => section.rows.map((row) => ({ ...row, section: section.id })))

  it('LibTV 对照里「已有 / 新增」的键都有一行', () => {
    const keys = rowsOf('MacIntel').map((row) => row.shortcutKey)
    for (const key of ['modG', 'modShiftG', 'modL', 'modD', 'tab', 'optShiftF', 'frameKey', 'modPlusMinus', 'modZ', 'modShiftZ', 'modX', 'altDrag']) {
      expect(keys, key).toContain(key)
    }
  })

  it('Mac 显示 ⌘ ⌥ ⇧，Windows 显示 Ctrl Alt Shift', () => {
    const mac = rowsOf('MacIntel').find((row) => row.shortcutKey === 'optShiftF')?.shortcutValues
    const win = rowsOf('Win32').find((row) => row.shortcutKey === 'optShiftF')?.shortcutValues
    expect(mac).toMatchObject({ mod: '⌘', opt: '⌥', shift: '⇧' })
    expect(win).toMatchObject({ mod: 'Ctrl', opt: 'Alt', shift: 'Shift' })
  })

  it('分组对齐同类画布：创作组里是成组 / 连线 / 复制 / 新建', () => {
    const create = rowsOf('MacIntel').filter((row) => row.section === 'create').map((row) => row.actionKey)
    expect(create).toEqual(expect.arrayContaining(['group', 'ungroup', 'connect', 'duplicate', 'addNode', 'tidy']))
  })
})
