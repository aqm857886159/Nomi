import { describe, expect, it } from 'vitest'
import { formatCanvasForAgent } from './canvasPromptContext'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

const node = (over: Partial<GenerationCanvasNode>): GenerationCanvasNode => ({
  id: 'n1',
  kind: 'image',
  title: '镜头 1',
  position: { x: 0, y: 0 },
  ...over,
})

describe('formatCanvasForAgent — T1 紧凑画布上下文', () => {
  it('空画布一句话', () => {
    expect(formatCanvasForAgent({ nodes: [], edges: [] })).toBe('画布当前为空。')
  })

  it('紧凑行:id/类型/标题/锁/出图态/prompt 截 60;结果等大字段不进', () => {
    const longPrompt = '清晨的京都小巷'.repeat(20)
    const text = formatCanvasForAgent({
      nodes: [
        node({ id: 'a', title: '小巷', prompt: longPrompt, locked: true }),
        node({ id: 'b', kind: 'video', title: '鸟居', result: { id: 'r', url: 'file:///x.png'.repeat(50), type: 'image' } as GenerationCanvasNode['result'] }),
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    })
    expect(text).toContain('a | image | 小巷 | 已锁定 | prompt: ')
    expect(text).toContain('b | video | 鸟居 | 已出图')
    expect(text).toContain('引用边: 小巷→鸟居')
    expect(text).not.toContain('file:///') // result url 等大字段绝不进
    // 截断生效:全文 280 字的 prompt 只留 60+省略号
    const line = text.split('\n').find((candidate) => candidate.includes('a | image'))!
    expect(line.length).toBeLessThan(120)
  })

  it('选中节点附完整提示词(润色要原文),其余只有摘要', () => {
    const longPrompt = '同一位年轻主角骑着自行车穿过一排朱红色鸟居,'.repeat(8)
    const selected = node({ id: 'sel', title: '鸟居', prompt: longPrompt })
    const text = formatCanvasForAgent({ nodes: [selected, node({ id: 'other', title: '别的' })], edges: [] }, [selected])
    expect(text).toContain('当前选中: sel')
    expect(text).toContain('「鸟居」(sel) 完整提示词:')
    expect(text).toContain(longPrompt)
  })

  it('exposes storyboard provenance so the Agent can choose one exact node subset', () => {
    const text = formatCanvasForAgent({
      nodes: [node({ id: 'shot-a', meta: { storyboardDesignId: 'design-a' } })],
      edges: [],
    })
    expect(text).toContain('shot-a | image | storyboard:design-a')
  })
})
