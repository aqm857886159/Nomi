import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ui/notificationPolicy', () => ({ notify: vi.fn() }))

import { handleCapabilityApply } from '../capability/capabilityApplyHandler'
import { readCurrentWorkbenchProjectPayload, restoreWorkbenchProjectPayload } from '../project/workbenchProjectSession'
import { useWorkbenchStore } from '../workbenchStore'
import { cloneEditingPanelLayout, EDITING_PANEL_DEFAULTS } from './panelLayout'

/**
 * 「窗口一窄，Agent 面板宽被写成 300，拉回来还是 300」（用户 2026-11-07；方向检查
 * docs/engineering/direction-checks/2026-11-08-workbench-shell-width-writeback.md）。
 *
 * 旧测试量的是纯函数 clampAssistantWidth（函数确实不改没超限的宽），会写存档的是 store 的写入口——尺子量错了层。
 * 这里换成：把窗口设成 700，调每一个会经过写入咽喉 clampEditingPanelLayout 的入口，读 store 里的 assistantWidth 与 persistRevision。
 * 窗口大小只影响显示（Grid 让步，assistantDockColumns）；只有人亲手拖（setAssistantWidth）按视口收上限。
 */
const STORED = 450
const NARROW_WINDOW = 700

function seed(): number {
  useWorkbenchStore.setState({
    editingPanelLayout: { ...cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), assistantWidth: STORED },
    editingPanelUndoStack: [],
    projectAgentDockCollapsed: false,
  })
  return useWorkbenchStore.getState().persistRevision
}

describe('窄窗下每个写入口都不把窗口大小写进 Agent 面板宽', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { innerWidth: NARROW_WINDOW, dispatchEvent: vi.fn() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Agent layout.write（只改别的栏）：面板宽原样，落盘游标只因那一栏动', async () => {
    const before = seed()
    await handleCapabilityApply('layout.write', { layout: { sourceWidth: 260 } })
    const state = useWorkbenchStore.getState()
    expect(state.editingPanelLayout.assistantWidth).toBe(STORED)
    expect(state.editingPanelLayout.sourceWidth).toBe(260)
    expect(state.persistRevision).toBe(before + 1)
  })

  it('Agent layout.write 给的面板宽：只夹静态界 300–600，不按窗口钳', async () => {
    seed()
    await handleCapabilityApply('layout.write', { layout: { assistantWidth: 520 } })
    expect(useWorkbenchStore.getState().editingPanelLayout.assistantWidth).toBe(520)
    await handleCapabilityApply('layout.write', { layout: { assistantWidth: 900 } })
    expect(useWorkbenchStore.getState().editingPanelLayout.assistantWidth).toBe(600)
  })

  it('打开项目还原：存的 450 在窄窗里读回来还是 450，落盘物里的布局一个字节不变', () => {
    seed()
    const savedLayout = { ...cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS), assistantWidth: STORED }
    const saved = { ...readCurrentWorkbenchProjectPayload(), editingPanelLayout: savedLayout }
    useWorkbenchStore.setState({ editingPanelLayout: cloneEditingPanelLayout(EDITING_PANEL_DEFAULTS) })
    restoreWorkbenchProjectPayload(saved)
    expect(useWorkbenchStore.getState().editingPanelLayout.assistantWidth).toBe(STORED)
    expect(JSON.stringify(readCurrentWorkbenchProjectPayload().editingPanelLayout)).toBe(JSON.stringify(savedLayout))
  })

  it('预览页开合栏（setEditingPanelLayout 只给可见性）：面板宽原样', () => {
    seed()
    useWorkbenchStore.getState().setEditingPanelLayout({ visibility: { source: false } })
    expect(useWorkbenchStore.getState().editingPanelLayout.assistantWidth).toBe(STORED)
  })

  it('预览页拖左栏 / 属性栏 / 时间轴后同步（syncEditingPanelSize）：面板宽原样', () => {
    const before = seed()
    useWorkbenchStore.getState().syncEditingPanelSize({ sourceWidth: 300 })
    useWorkbenchStore.getState().syncEditingPanelSize({ inspectorWidth: 260 })
    useWorkbenchStore.getState().syncEditingPanelSize({ timelineHeight: 240 })
    const state = useWorkbenchStore.getState()
    expect(state.editingPanelLayout.assistantWidth).toBe(STORED)
    expect(state.persistRevision).toBeGreaterThan(before)
    // 什么都没变的同步：不 bump（窗口来回拖不让项目变脏）。
    const settled = state.persistRevision
    useWorkbenchStore.getState().syncEditingPanelSize({ sourceWidth: 300 })
    expect(useWorkbenchStore.getState().persistRevision).toBe(settled)
  })

  it('人亲手拖（setAssistantWidth）照旧按视口收上限：1100 宽拖到 500 → 340，手柄跟手', () => {
    seed()
    vi.stubGlobal('window', { innerWidth: 1100 })
    useWorkbenchStore.getState().setAssistantWidth(500)
    expect(useWorkbenchStore.getState().editingPanelLayout.assistantWidth).toBe(340)
  })
})

describe('结构：写面板宽的咽喉不读窗口，窗口宽只影响显示', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it.each(['./panelLayout.ts', './editingPanelLayoutSlice.ts'])('%s 里没有 window.innerWidth / clampAssistantWidth', (rel) => {
    const source = read(rel)
    expect(source).not.toMatch(/\bwindow\s*\.\s*innerWidth\b/)
    expect(source).not.toContain('clampAssistantWidth')
  })

  it('外壳组合根不再监听窗口去改面板宽（WorkbenchShell 那段 resize 监听已删）', () => {
    const source = read('../WorkbenchShell.tsx')
    expect(source).not.toContain('assistantWidthMaxFor')
    expect(source).not.toContain('setAssistantWidth')
  })

  it.each([
    '../creation/CreationWorkspace.tsx',
    '../creation/storyboard/StoryboardWorkspace.tsx',
    '../generation/GenerationWorkspace.tsx',
    './PreviewWorkspace.tsx',
  ])('%s 的停靠两列出自唯一出处 assistantDockColumns*，不再自己拼「1fr + 存的宽」', (rel) => {
    const source = read(rel)
    expect(source).toMatch(/assistantDockColumns(Animated)?\(/)
    expect(source).not.toMatch(/gridTemplateColumns:[^\n]*minmax\(0,\s*1fr\)\s+(\$\{|var\()/)
    expect(source).not.toMatch(/grid-cols-\[minmax\(0,1fr\)_/)
  })
})
