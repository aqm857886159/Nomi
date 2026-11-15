// 设计卡「11-12 改向」九种状态，每条一条测试——走真实画布 store（连线 / 断线 / 换模型都经 store 写口，store 边界的
// canvasModeChoiceForget 订阅照常跑），读方式只经唯一入口 effectiveArchetypeMode，方式格的菜单经 buildModeMenu。
// 反例：方式格改回读存着的方式 → ③④⑤ 红；关掉 canvasModeChoiceForget（减少不跳回靠它）→ ⑤ 红；
// 关掉自动换方式（owner 偏好放不下也照用）→ ④ 红。
import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { liveModeSwitchNotice } from './canvasModeChoiceForget'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { applyHumanModeChoice, collectModeInputs, effectiveArchetypeMode } from '../nodes/controls/archetypeMeta'
import { buildModeMenu } from '../nodes/controls/modeMenuModel'
import { readModePreference } from '../nodes/controls/modePreference'
import { archetypeModeChoices } from '../nodes/controls/channelModeReach'
import { resolveReferencePlacement } from '../runner/referenceSlots'
import { resolveGenerationReferences } from '../runner/generationReferenceResolver'
import { buildCatalogTaskRequest } from '../runner/catalogTaskActions'
import { taskTemplateParams } from '../../../../electron/catalog/taskParams'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const SEEDANCE = { modelKey: 'bytedance/seedance-2-5', modelVendor: 'kie', archetype: { id: 'seedance-2.5', modeId: 't2v' } }
const KLING4 = { modelKey: 'kling-v4', modelVendor: 'kie', archetype: { id: 'kling-v4', modeId: 't2v' } }

function source(id: string): GenerationCanvasNode {
  return {
    id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots',
    result: { id: `${id}-r`, type: 'image', url: `nomi-local://${id}.png`, createdAt: 1 },
  }
}

function target(kind: 'video' | 'image', meta: Record<string, unknown>): GenerationCanvasNode {
  return { id: 'v', kind, title: 'v', position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots', meta }
}

const store = () => useGenerationCanvasStore.getState()
const node = () => store().nodes.find((candidate) => candidate.id === 'v')!
function resolved() {
  const current = node()
  return effectiveArchetypeMode(archetypeForNode(current)!, current, { nodes: store().nodes, edges: store().edges })
}
function menu() {
  const current = node()
  const archetype = archetypeForNode(current)!
  const inputs = collectModeInputs(current, { nodes: store().nodes, edges: store().edges })
  return buildModeMenu({ nodeKind: current.kind === 'video' ? 'video' : 'other', archetype, visible: archetypeModeChoices(archetype), inputs: inputs.inputs, firstFrameEmpty: inputs.firstFrameEmpty, resolvedModeId: resolved().mode.id })
}
const connect = (id: string) => store().connectNodes(id, 'v', 'reference')
const disconnect = (id: string) => store().disconnectEdge(store().edges.find((edge) => edge.source === id && edge.target === 'v')!.id)
function choose(modeId: string) {
  const current = node()
  store().updateNode('v', { meta: applyHumanModeChoice((current.meta || {}) as Record<string, unknown>, archetypeForNode(current)!, modeId) })
}
const notice = () => liveModeSwitchNotice(node().meta as Record<string, unknown>, collectModeInputs(node(), { nodes: store().nodes, edges: store().edges }).inputs.length, resolved().mode.id)

function open(meta: Record<string, unknown>, kind: 'video' | 'image' = 'video') {
  store().restoreSnapshot({ nodes: [target(kind, meta), source('a'), source('b'), source('c'), source('d')], edges: [], groups: [] })
}

describe('方式按输入现算 · 九种状态', () => {
  beforeEach(() => open(SEEDANCE))

  it('① 没放输入 = 文生视频（方式格显示文生，带图的几行置灰写「先放…」）', () => {
    expect(resolved().mode.id).toBe('t2v')
    const rows = menu()!.rows
    expect(rows.find((row) => row.id === 't2v')).toMatchObject({ kind: 'text', disabled: false })
    expect(rows.filter((row) => row.id !== 't2v').every((row) => row.disabled)).toBe(true)
  })

  it('② 放了输入、没手选 = 放得下全部输入的默认那种（Seedance 是全能参考）', () => {
    connect('a')
    expect(resolved()).toMatchObject({ mode: { id: 'omni' }, status: 'ok', taken: 1 })
    expect(menu()!.activeId).toBe('omni')
    expect(menu()!.rows.find((row) => row.id === 'first')!.disabled).toBe(false)
  })

  it('③ 手选只在放得下全部输入时生效（2 张选首尾帧生效；3 张时首尾帧置灰）', () => {
    connect('a'); connect('b')
    choose('firstlast')
    expect(resolved().mode.id).toBe('firstlast')
    connect('c')
    expect(resolved().mode.id).toBe('omni')
    expect(menu()!.rows.find((row) => row.id === 'firstlast')).toMatchObject({ disabled: true, description: { values: { count: 3, taken: 2 } } })
  })

  it('④ 输入加多、放不下 → 自动换成放得下全部的那种，行尾「放了 3 张，已改成全能参考」', () => {
    connect('a'); connect('b')
    choose('firstlast')
    connect('c')
    expect(resolved().mode.id).toBe('omni')
    expect(notice()).toEqual({ modeId: 'omni', count: 3 })
    // 发出去的也是这一种：参考行按它摆，三张都在格子里。
    const placed = resolveReferencePlacement(node(), store().nodes, store().edges)
    expect(placed.slots.flatMap((slot) => slot.fills).length).toBe(3)
  })

  it('⑤ 输入减少不跳回（删回 2 张还是全能参考，首尾帧又能点了；「已改成」不再说）', () => {
    connect('a'); connect('b')
    choose('firstlast')
    connect('c')
    disconnect('c')
    expect(resolved().mode.id).toBe('omni')
    expect(menu()!.rows.find((row) => row.id === 'firstlast')!.disabled).toBe(false)
    expect(notice()).toBeNull()
  })

  it('⑥ 删光回文生视频', () => {
    connect('a'); connect('b')
    disconnect('a'); disconnect('b')
    expect(resolved().mode.id).toBe('t2v')
  })

  it('⑦ 换模型后按规则重算（Seedance 全能参考 2 张 → 可灵 4.0 图生视频，2 张都收下）', () => {
    connect('a'); connect('b')
    store().updateNode('v', { meta: { ...node().meta, ...KLING4 } })
    expect(resolved()).toMatchObject({ mode: { id: 'i2v' }, status: 'ok', taken: 2 })
  })

  it('⑧ 模型没有方式放得下全部（可灵 4.0 最多 2 张，连了 3 张）→ 留在收得最多的那种，第 3 张不会发、照样能发', () => {
    connect('a'); connect('b'); connect('c')
    store().updateNode('v', { meta: { ...node().meta, ...KLING4 } })
    const result = resolved()
    expect(result).toMatchObject({ mode: { id: 'i2v' }, status: 'ok', taken: 2 })
    // 请求体：渲染层真发送那条路（resolveGenerationReferences → buildCatalogTaskRequest → 模板参数），第 3 张一个字节都不带。
    const references = resolveGenerationReferences(node(), { nodes: store().nodes, edges: store().edges })
    const params = JSON.stringify(taskTemplateParams(buildCatalogTaskRequest(node(), { references }).request))
    expect(params).toContain('nomi-local://a.png')
    expect(params).toContain('nomi-local://b.png')
    expect(params).not.toContain('nomi-local://c.png')
    const placed = resolveReferencePlacement(node(), store().nodes, store().edges)
    expect(placed.slots.flatMap((slot) => slot.fills).map((fill) => fill.url)).toEqual(['nomi-local://a.png', 'nomi-local://b.png'])
    expect(menu()!.rows.every((row) => row.disabled || row.id === 'i2v')).toBe(true)
  })

  it('上游还没出图的连线也算输入（先跑上游备齐参考），打开老项目不改写存盘', () => {
    const pending = { ...source('p'), result: undefined }
    const before = { ...SEEDANCE, archetype: { id: 'seedance-2.5', modeId: 'firstlast' } }
    store().restoreSnapshot({ nodes: [target('video', before), pending], edges: [{ id: 'e', source: 'p', target: 'v', mode: 'reference' }], groups: [] })
    expect(resolved()).toMatchObject({ status: 'ok', taken: 1 })
    expect(resolved().mode.intent).not.toBe('text')
    expect(node().meta).toEqual(before)
  })

  // 「放不下就忘掉偏好」是连线这个手势的后果，必须落在手势的撤销点之后：撤一次连线，手选的首尾帧要一起回来
  // （2026-11-12 修：store 订阅在 set() 里先于撤销点写入，⌘Z 撤了边、偏好却没回来）。
  it('撤销 / 重做连线：方式跟着输入走，手选的首尾帧随撤销回来，「已改成」不残留', () => {
    connect('a'); connect('b')
    choose('firstlast')
    // 用户手拖这一条（connectToNode 会打撤销点；Agent 的 connectNodes 不单独成一步）。
    store().startConnection('c', 'right')
    expect(store().connectToNode('v', { mode: 'reference' })).toMatchObject({ ok: true })
    expect(resolved().mode.id).toBe('omni')
    store().undo()
    expect(store().edges).toHaveLength(2)
    expect(resolved().mode.id).toBe('firstlast')
    expect(notice()).toBeNull()
    expect(menu()!.rows.find((row) => row.id === 'firstlast')!.disabled).toBe(false)
    store().redo()
    expect(store().edges).toHaveLength(3)
    expect(resolved().mode.id).toBe('omni')
  })

  // 验收 C4（2026-11-12，低把握、未实跑）：「忘掉偏好」不进撤销栈（history: false），重做回来的那一态里偏好还在不在？
  // 还在的话，重做之后删回 2 张，方式会跳回首尾帧，违反 ⑤「减少不跳回」。这条把整条 ⌘Z / ⇧⌘Z 路走一遍。
  it('撤销 → 重做 → 删回 2 张：方式不跳回首尾帧（忘掉偏好和连第 3 张同进一个撤销步）', () => {
    connect('a'); connect('b')
    choose('firstlast')
    expect(resolved().mode.id).toBe('firstlast')
    store().startConnection('c', 'right')
    expect(store().connectToNode('v', { mode: 'reference' })).toMatchObject({ ok: true })
    expect(resolved().mode.id).toBe('omni')
    store().undo()
    expect(resolved().mode.id).toBe('firstlast')
    store().redo()
    expect(resolved().mode.id).toBe('omni')
    // 重做回来的那一态里，放不下的首尾帧偏好已经忘掉了（不是靠之后再算一次补上）。
    expect(readModePreference(archetypeForNode(node())!, node().meta as Record<string, unknown>)).toBeNull()
    disconnect('c')
    expect(store().edges).toHaveLength(2)
    expect(resolved().mode.id).toBe('omni')
    expect(notice()).toBeNull()
  })

  it('⑨ 图片节点：没有方式格（菜单只给视频节点算；图片放了图就是按图改）', () => {
    open({ modelKey: 'nano-banana', archetype: { id: 'nano-banana', modeId: 't2i' } }, 'image')
    connect('a')
    expect(resolved().mode.intent).not.toBe('text')
    expect(menu()).toBeNull()
  })
})
