import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { CanvasReadResult } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { formatCanvasForAgent, MAX_CANVAS_PROMPT_CHARACTERS } from './canvasPromptContext'

type CanvasReadNode = CanvasReadResult['nodes'][number]

const node = (overrides: Partial<CanvasReadNode> = {}): CanvasReadNode => ({
  id: 'n1',
  kind: 'image',
  title: '镜头 1',
  prompt: '',
  status: 'idle',
  position: { x: 0, y: 0 },
  locked: false,
  hasResult: false,
  ...overrides,
})

const canvas = (overrides: Partial<CanvasReadResult> = {}): CanvasReadResult => ({
  nodes: [],
  edges: [],
  groups: [],
  selectedNodeIds: [],
  ...overrides,
})

describe('formatCanvasForAgent — canonical canvas.read compact presentation', () => {
  it('accepts only CanvasReadResult and renders an empty canvas in one sentence', () => {
    expectTypeOf(formatCanvasForAgent).parameter(0).toEqualTypeOf<CanvasReadResult>()
    expect(formatCanvasForAgent(canvas())).toBe('画布当前为空。')
  })

  it('renders canonical result identity without serializing provider payloads', () => {
    const longPrompt = '清晨的京都小巷'.repeat(20)
    const text = formatCanvasForAgent(canvas({
      nodes: [
        node({ id: 'a', title: '小巷', prompt: longPrompt, locked: true }),
        node({
          id: 'b', kind: 'video', title: '鸟居', hasResult: true,
          currentResultId: 'opaque-current', resultIds: ['opaque-current', 'opaque-history'],
        }),
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', mode: 'reference' }],
    }))

    expect(text).toContain('a | image | 小巷 | 已锁定 | prompt: ')
    expect(text).toContain('b | video | 鸟居 | 已有结果')
    expect(text).toContain('currentResultId: opaque-current')
    expect(text).toContain('resultIds: opaque-current, opaque-history')
    expect(text).toContain('引用边: 小巷→鸟居')
    const line = text.split('\n').find((candidate) => candidate.includes('a | image'))!
    expect(line.length).toBeLessThan(140)

    const source = readFileSync(new URL('./canvasPromptContext.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('JSON.stringify')
  })

  it.each(['audio', 'text', 'model3d', 'video'])('reports canonical %s hasResult without inferring a result media type', (kind) => {
    const text = formatCanvasForAgent(canvas({
      nodes: [
        node({ id: `${kind}-result`, kind, title: `${kind} result`, hasResult: true }),
        node({ id: `${kind}-empty`, kind, title: `${kind} empty`, hasResult: false }),
      ],
    }))
    const resultLine = text.split('\n').find((line) => line.includes(`${kind}-result`))!
    const emptyLine = text.split('\n').find((line) => line.includes(`${kind}-empty`))!

    expect(resultLine).toContain('已有结果')
    expect(resultLine).not.toContain('已出图')
    expect(resultLine).not.toContain('已出视频')
    expect(emptyLine).not.toContain('已有结果')
  })

  it('uses selectedNodeIds as the sole owner of complete selected-node prompts', () => {
    const selectedPrompt = '同一位年轻主角骑着自行车穿过一排朱红色鸟居，'.repeat(8)
    const unselectedPrompt = '这段同样很长但不能作为完整提示词出现。'.repeat(8)
    const text = formatCanvasForAgent(canvas({
      nodes: [
        node({ id: 'selected', title: '鸟居', prompt: selectedPrompt }),
        node({ id: 'other', title: '别的', prompt: unselectedPrompt }),
      ],
      selectedNodeIds: ['selected'],
    }))

    expect(text).toContain('当前选中: selected')
    expect(text).toContain('「鸟居」(selected) 完整提示词:')
    expect(text).toContain(selectedPrompt)
    expect(text).not.toContain(unselectedPrompt)
  })

  it('budgets selected full prompts after core node, edge, selection, and result identity', () => {
    const selectedPrompt = `SELECTED PROMPT START ${'很长的选中提示词'.repeat(1_500)} SELECTED PROMPT END`
    const text = formatCanvasForAgent(canvas({
      nodes: [
        node({
          id: 'selected', title: '选中镜头', prompt: selectedPrompt, hasResult: true,
          currentResultId: 'result-current', resultIds: ['result-current', 'result-history'],
        }),
        node({ id: 'reference', title: '参考镜头', hasResult: true, currentResultId: 'reference-current' }),
      ],
      edges: [{ id: 'edge-identity', source: 'reference', target: 'selected', mode: 'reference' }],
      selectedNodeIds: ['selected'],
    }))

    expect(text.length).toBeLessThanOrEqual(MAX_CANVAS_PROMPT_CHARACTERS)
    expect(text).toContain('当前选中: selected')
    expect(text).toContain('- selected | image | 选中镜头')
    expect(text).toContain('- reference | image | 参考镜头')
    expect(text).toContain('引用边: 参考镜头→选中镜头')
    expect(text).toContain('currentResultId: result-current')
    expect(text).toContain('resultIds: result-current, result-history')
    expect(text).toContain('SELECTED PROMPT START')
    expect(text).not.toContain('SELECTED PROMPT END')
    expect(text.indexOf('- selected | image')).toBeLessThan(text.indexOf('完整提示词:'))
  })

  it('has a deterministic hard output bound for a very large canonical canvas', () => {
    const selectedPrompt = `SELECTED FULL PROMPT ${'关键内容'.repeat(40)}`
    const nodes = Array.from({ length: 600 }, (_, index) => node({
      id: `node-${index}`,
      title: `镜头 ${index} ${'标题'.repeat(40)}`,
      prompt: index === 599 ? selectedPrompt : `prompt-${index}-${'内容'.repeat(200)}`,
    }))
    const text = formatCanvasForAgent(canvas({ nodes, selectedNodeIds: ['node-599'] }))

    expect(text.length).toBeLessThanOrEqual(MAX_CANVAS_PROMPT_CHARACTERS)
    expect(text.endsWith('…')).toBe(true)
    expect(MAX_CANVAS_PROMPT_CHARACTERS).toBeLessThanOrEqual(12_000)
    expect(text).toContain(selectedPrompt)
  })

})
