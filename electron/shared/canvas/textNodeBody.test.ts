import { describe, expect, it } from 'vitest'

import { projectCanvasRead, MAX_CANVAS_TEXT_NODE_CHARACTERS } from '../agentCapabilities/canvasRead'
import { formatCanvasForAgent } from '../agentCapabilities/canvasReadCompact'
import { docToPlainText, textNodeBody, tiptapDocFromPlainText } from './textNodeBody'

describe('文本节点正文', () => {
  it('纯文本 → 文档 → 纯文本 往返不丢行，空行被丢掉（与下游拼接口径一致）', () => {
    expect(docToPlainText(tiptapDocFromPlainText('a\n\nb'))).toBe('a\nb')
  })

  it('正文优先级：文档 > 最近一次生成结果文本 > 提示词', () => {
    expect(textNodeBody({ contentJson: tiptapDocFromPlainText('doc'), result: { text: 'r' }, prompt: 'p' })).toBe('doc')
    expect(textNodeBody({ result: { text: ' r ' }, prompt: 'p' })).toBe('r')
    expect(textNodeBody({ prompt: ' p ' })).toBe('p')
  })
})

describe('canvas.read 给 Agent 文本节点正文', () => {
  const textNode = (text: string) => ({ id: 'n1', kind: 'text', title: '风格', contentJson: tiptapDocFromPlainText(text) })

  it('文本节点带正文；非文本节点不带 text 字段', () => {
    const read = projectCanvasRead({ nodes: [textNode('暖色逆光'), { id: 'n2', kind: 'image', prompt: 'p' }], edges: [], groups: [], selectedNodeIds: [] })
    expect(read.nodes[0]).toMatchObject({ text: '暖色逆光' })
    expect(read.nodes[0]).not.toHaveProperty('textTruncated')
    expect(read.nodes[1]).not.toHaveProperty('text')
  })

  it('超长正文截断并明说截断了', () => {
    const read = projectCanvasRead({ nodes: [textNode('字'.repeat(MAX_CANVAS_TEXT_NODE_CHARACTERS + 50))], edges: [], groups: [], selectedNodeIds: [] })
    const node = read.nodes[0]!
    expect(node.text!.length).toBe(MAX_CANVAS_TEXT_NODE_CHARACTERS)
    expect(node.text!.endsWith('…')).toBe(true)
    expect(node.textTruncated).toBe(true)
    expect(formatCanvasForAgent(read)).toContain('正文已截断')
  })

  it('选中的文本节点在摘要里展开整段正文，没选中的只给一行开头', () => {
    const long = '第一句。'.repeat(40)
    const selected = formatCanvasForAgent(projectCanvasRead({ nodes: [textNode(long)], edges: [], groups: [], selectedNodeIds: ['n1'] }))
    const unselected = formatCanvasForAgent(projectCanvasRead({ nodes: [textNode(long)], edges: [], groups: [], selectedNodeIds: [] }))
    expect(selected).toContain('文本正文')
    expect(selected).toContain(long)
    expect(unselected).not.toContain('文本正文')
    expect(unselected).toContain('text: 第一句。')
  })
})
