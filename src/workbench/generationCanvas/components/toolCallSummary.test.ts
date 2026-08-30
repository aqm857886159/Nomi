import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildStepDetailLabels, countCreatedNodesByCategory, summarizeToolCall, describeToolCallDetail } from './toolCallSummary'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import i18n, { DEFAULT_LOCALE } from '../../../i18n'

// id→标题翻译读 store 节点(A6:杀掉漏给用户的 n1/shot-1 这类机器 id)。测试注入几个有标题的节点。
function seedNodes(nodes: Array<{ id: string; title: string }>): void {
  useGenerationCanvasStore.setState({ nodes: nodes as unknown as never })
}
afterEach(() => seedNodes([]))

describe('summarizeToolCall — 时间线步骤标题(人话,无 toolName 原文)', () => {
  it('各工具翻成人话动词短语', () => {
    seedNodes([{ id: 'n1', title: '镜1' }])
    expect(summarizeToolCall('create_canvas_nodes', { nodes: [1, 2, 3], summary: '海边三镜头' })).toBe('创建 3 个节点：海边三镜头')
    expect(summarizeToolCall('connect_canvas_edges', { edges: [1, 2] })).toBe('连接 2 条引用线')
    expect(summarizeToolCall('set_node_prompt', { nodeId: 'n1' })).toBe('改写「镜1」的提示词')
    expect(summarizeToolCall('delete_canvas_nodes', { nodeIds: ['a'] })).toBe('删除 1 个节点')
    expect(summarizeToolCall('run_generation_batch', { nodeIds: ['a', 'b'] })).toContain('批量生成 2 个节点')
  })

  it('set_node_prompt 查不到节点 → 退回不带 id 的人话(不漏机器串)', () => {
    seedNodes([])
    const summary = summarizeToolCall('set_node_prompt', { nodeId: 'n1' })
    expect(summary).toBe('改写节点提示词')
    expect(summary).not.toContain('n1')
  })

  it('未知工具退回工具名(不崩)', () => {
    expect(summarizeToolCall('mystery', {})).toBe('mystery')
  })
})

describe('describeToolCallDetail — 副标题翻 args(杀 raw id/JSON)', () => {
  it('connect 翻成「源标题 →目标标题」,不漏 clientId', () => {
    seedNodes([{ id: 'shot-1', title: '镜1' }, { id: 'shot-2', title: '镜2' }, { id: 'shot-3', title: '镜3' }])
    const detail = describeToolCallDetail('connect_canvas_edges', {
      edges: [
        { sourceClientId: 'shot-1', targetClientId: 'shot-2' },
        { sourceClientId: 'shot-2', targetClientId: 'shot-3' },
      ],
    })
    expect(detail).toBe('「镜1」→「镜2」，「镜2」→「镜3」')
    expect(detail).not.toContain('shot-')
    expect(detail).not.toContain('{')
  })

  it('connect 查不到标题的边跳过(不灌 id)', () => {
    seedNodes([])
    expect(describeToolCallDetail('connect_canvas_edges', {
      edges: [{ sourceClientId: 'shot-1', targetClientId: 'shot-2' }],
    })).toBe('')
  })

  it('set_node_prompt 截断长提示词', () => {
    const long = '一'.repeat(200)
    const detail = describeToolCallDetail('set_node_prompt', { prompt: long })
    expect(detail.length).toBeLessThan(90)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('delete/batch 列节点标题(非 id);read 无 detail', () => {
    seedNodes([{ id: 'a', title: '镜A' }, { id: 'b', title: '镜B' }])
    expect(describeToolCallDetail('delete_canvas_nodes', { nodeIds: ['a', 'b'] })).toBe('「镜A」、「镜B」')
    expect(describeToolCallDetail('read_canvas_state', {})).toBe('')
  })
})

describe('buildStepDetailLabels — 回执逐项明细(审计 A16)', () => {
  it('创建节点 → 每节点一行「标题 → 落点分类」(落点回报,A1)', () => {
    const labels = buildStepDetailLabels('create_canvas_nodes', {
      nodes: [
        { kind: 'character', title: '主人公定妆' },
        { kind: 'image', title: '镜头 1 清晨街道' },
        { kind: 'video' },
      ],
    })
    expect(labels).toHaveLength(3)
    expect(labels[0]).toBe('「主人公定妆」→ 角色')
    expect(labels[1]).toBe('「镜头 1 清晨街道」→ 分镜')
    expect(labels[2]).toContain('→ 分镜')
  })

  it('连接边 → 按语义分组计数,不灌 id 串', () => {
    const labels = buildStepDetailLabels('connect_canvas_edges', {
      edges: [
        { mode: 'character_ref' },
        { mode: 'character_ref' },
        { mode: 'first_frame' },
      ],
    })
    expect(labels).toHaveLength(1)
    expect(labels[0]).toContain('连接 3 条引用线')
    expect(labels[0]).toContain('角色 2')
    expect(labels[0]).toContain('首帧 1')
  })

  it('其余工具退回一行摘要', () => {
    expect(buildStepDetailLabels('delete_canvas_nodes', { nodeIds: ['a'] })).toEqual(['删除 1 个节点'])
  })
})

describe('countCreatedNodesByCategory — 落点分组(审计 A1)', () => {
  it('跨分类创建按分类计数,供回执跳转 chip / toast 落点行', () => {
    const counts = countCreatedNodesByCategory([
      {
        toolName: 'create_canvas_nodes',
        effectiveArgs: {
          nodes: [
            { kind: 'character' },
            { kind: 'character' },
            { kind: 'scene' },
            { kind: 'image' },
            { kind: 'video' },
          ],
        },
      },
      { toolName: 'connect_canvas_edges', effectiveArgs: { edges: [] } },
    ])
    const byId = new Map(counts.map((item) => [item.categoryId, item]))
    expect(byId.get('cast')).toMatchObject({ label: '角色', count: 2 })
    expect(byId.get('scene')).toMatchObject({ label: '场景', count: 1 })
    expect(byId.get('shots')).toMatchObject({ label: '分镜', count: 2 })
  })
})

// 英文界面回归闸(R15):这套摘要曾整份硬编码中文、直接渲染在 AI 时间线上,英文界面照样出中文。
// 断言两件事——① 切 en 后一个汉字都不许剩;② 单复数是真英语("Create 1 node" 不是 "Create 1 nodes")。
describe('summarizeToolCall — English locale', () => {
  const HAN = /[\u4e00-\u9fff]/

  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE)
  })

  it('英文界面下不残留任何汉字', () => {
    seedNodes([{ id: 'n1', title: 'Shot 1' }])
    const lines = [
      summarizeToolCall('create_canvas_nodes', { nodes: [1, 2, 3], summary: 'three seaside shots' }),
      summarizeToolCall('connect_canvas_edges', { edges: [1, 2] }),
      summarizeToolCall('set_node_prompt', { nodeId: 'n1' }),
      summarizeToolCall('delete_canvas_nodes', { nodeIds: ['n1'] }),
      summarizeToolCall('run_generation_batch', { nodeIds: ['n1'] }),
      summarizeToolCall('read_canvas_state', {}),
      summarizeToolCall('arrange_storyboard_to_timeline', { nodeIds: ['n1'] }),
      summarizeToolCall('arrange_storyboard_to_timeline', {}),
      summarizeToolCall('tidy_canvas', { categoryId: 'cast' }),
      summarizeToolCall('tidy_canvas', {}),
      summarizeToolCall('create_staging_reference', { characters: [1, 2], camera: { shot: 'wide' } }),
      summarizeToolCall('create_camera_move', { move: 'push_in', speed: 'slow', shot: 'wide' }),
      ...buildStepDetailLabels('connect_canvas_edges', { edges: [{ mode: 'first_frame' }, { mode: 'style_ref' }] }),
      ...buildStepDetailLabels('create_canvas_nodes', { nodes: [{ kind: 'image', title: 'Hero look' }] }),
      describeToolCallDetail('delete_canvas_nodes', { nodeIds: ['n1'] }),
    ]
    for (const line of lines) expect(line, line).not.toMatch(HAN)
  })

  it('单复数走 i18next 复数式,不出 "1 nodes"', () => {
    expect(summarizeToolCall('create_canvas_nodes', { nodes: [1] })).toBe('Create 1 node')
    expect(summarizeToolCall('create_canvas_nodes', { nodes: [1, 2] })).toBe('Create 2 nodes')
    expect(summarizeToolCall('connect_canvas_edges', { edges: [1] })).toBe('Connect 1 reference link')
    expect(summarizeToolCall('connect_canvas_edges', { edges: [1, 2] })).toBe('Connect 2 reference links')
  })

  it('内置分类名与连接语义复用既有译名,不另起第二份', () => {
    expect(summarizeToolCall('tidy_canvas', { categoryId: 'cast' })).toContain('Characters')
    expect(buildStepDetailLabels('connect_canvas_edges', { edges: [{ mode: 'first_frame' }] })[0]).toContain('First frame')
  })
})
