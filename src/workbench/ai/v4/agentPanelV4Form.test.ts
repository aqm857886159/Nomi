import { describe, expect, it } from 'vitest'
import { collapseV4Flow } from './agentPanelV4Collapse'
import type { V4FlowItem } from './agentPanelV4Types'
const t = (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values ?? {})}`
const tool = (label: string, status: 'output-available' | 'output-error' | 'input-available' = 'output-available'): V4FlowItem => ({ kind: 'tool', receipt: { label, action: 'document', status, summary: status === 'output-error' ? '无法读取' : undefined } })
const thinking: V4FlowItem = { kind: 'thinking', label: '思考', meta: '', text: '检查文稿', streaming: false }
const answer: V4FlowItem = { kind: 'assistant', text: '已完成八个镜头。', status: 'complete' }
describe('B2c process contract', () => {
  it('settles interleaved thinking and calls into one process, keeping an early answer below it', () => {
    const result = collapseV4Flow([answer, tool('读取全文'), thinking, tool('写入 8 镜')], t)
    expect(result.map(item => item.kind)).toEqual(['process', 'assistant'])
    expect(result[0]).toMatchObject({ running: false, toolCount: 2 })
    expect(result[1]).toEqual(answer)
  })
  it('replaces the live row with the latest tool instead of leaving previous steps on screen', () => {
    const result = collapseV4Flow([tool('读取全文'), thinking, tool('加载分镜技能', 'input-available')], t)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'process', running: true, label: '加载分镜技能' })
  })
  it('keeps an unresolved failure outside collapsed details and keeps the answer', () => {
    const result = collapseV4Flow([tool('读取全文'), tool('写入 8 镜', 'output-error'), answer], t)
    expect(result.map(item => item.kind)).toEqual(['process', 'error', 'assistant'])
    expect(result[1]).toMatchObject({ reason: '无法读取' })
  })
  it('does not join processes across a user message', () => {
    const result = collapseV4Flow([tool('读取全文'), { kind: 'user', text: '继续' }, tool('加载技能')], t)
    expect(result.map(item => item.kind)).toEqual(['process', 'user', 'process'])
  })
})

// Real invocation order is also the interaction index used for retry/undo handlers.
it('preserves tool ordering and action indexes with the C77 thinking disclosure first', () => {
  const result = collapseV4Flow([answer, tool('读取全文'), thinking, tool('写入 8 镜')], t)
  expect(result[0]).toMatchObject({ details: [
    { index: 2, item: { kind: 'thinking', text: '检查文稿', streaming: false } },
    { index: 1, item: { kind: 'tool' } },
    { index: 3, item: { kind: 'tool' } },
  ] })
})

it('keeps recovered failures in details and counts retries without leaving a false failure card', () => {
  const result = collapseV4Flow([tool('写入 8 镜', 'output-error'), thinking, tool('写入 8 镜', 'output-error'), tool('写入 8 镜'), answer], t)
  expect(result.map(item => item.kind)).toEqual(['process', 'assistant'])
  expect(result[0]).toMatchObject({ toolCount: 3, retries: 2, running: false })
})
