import { describe, expect, it } from 'vitest'
import { summarizeToolCall, describeToolCallDetail } from './toolCallSummary'

describe('summarizeToolCall — 时间线步骤标题(人话,无 toolName 原文)', () => {
  it('各工具翻成人话动词短语', () => {
    expect(summarizeToolCall('create_canvas_nodes', { nodes: [1, 2, 3], summary: '海边三镜头' })).toBe('创建 3 个节点：海边三镜头')
    expect(summarizeToolCall('connect_canvas_edges', { edges: [1, 2] })).toBe('连接 2 条引用线')
    expect(summarizeToolCall('set_node_prompt', { nodeId: 'n1' })).toBe('改写节点 n1 的提示词')
    expect(summarizeToolCall('delete_canvas_nodes', { nodeIds: ['a'] })).toBe('删除 1 个节点')
    expect(summarizeToolCall('run_generation_batch', { nodeIds: ['a', 'b'] })).toContain('批量生成 2 个节点')
  })

  it('未知工具退回工具名(不崩)', () => {
    expect(summarizeToolCall('mystery', {})).toBe('mystery')
  })
})

describe('describeToolCallDetail — 副标题翻 args(杀 raw JSON)', () => {
  it('connect 翻成「A → B」箭头行,不再是 JSON', () => {
    const detail = describeToolCallDetail('connect_canvas_edges', {
      edges: [
        { sourceClientId: 'shot-1', targetClientId: 'shot-2' },
        { sourceClientId: 'shot-2', targetClientId: 'shot-3' },
      ],
    })
    expect(detail).toBe('shot-1 → shot-2，shot-2 → shot-3')
    expect(detail).not.toContain('{')
  })

  it('set_node_prompt 截断长提示词', () => {
    const long = '一'.repeat(200)
    const detail = describeToolCallDetail('set_node_prompt', { prompt: long })
    expect(detail.length).toBeLessThan(90)
    expect(detail.endsWith('…')).toBe(true)
  })

  it('delete/batch 列 id;read 无 detail', () => {
    expect(describeToolCallDetail('delete_canvas_nodes', { nodeIds: ['a', 'b'] })).toBe('a，b')
    expect(describeToolCallDetail('read_canvas_state', {})).toBe('')
  })
})
