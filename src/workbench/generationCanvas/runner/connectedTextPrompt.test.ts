import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { projectConnectedTextInputs, withConnectedTextPrompts } from './connectedTextPrompt'

function imageNode(id: string, prompt = ''): GenerationCanvasNode {
  return { id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt } as GenerationCanvasNode
}

function videoNode(id: string, prompt = ''): GenerationCanvasNode {
  return { id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt } as GenerationCanvasNode
}

function textNode(id: string, text: string): GenerationCanvasNode {
  return {
    id,
    kind: 'text',
    title: id,
    position: { x: 0, y: 0 },
    prompt: 'legacy prompt should not win',
    contentJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  } as GenerationCanvasNode
}

function edge(
  source: string,
  target: string,
  order: number,
  mode: GenerationCanvasEdge['mode'] = 'reference',
): GenerationCanvasEdge {
  return { id: `${source}-${target}-${mode}`, source, target, mode, order } as GenerationCanvasEdge
}

describe('connected text prompt context', () => {
  it('按边顺序把文本节点正文附加到图片 prompt，且不修改原节点', () => {
    const target = imageNode('img', 'base frame')
    const first = textNode('t1', 'first text block')
    const second = textNode('t2', 'second text block')
    const nodes = [target, first, second]
    const edges = [edge('t2', 'img', 1), edge('t1', 'img', 0)]

    expect(projectConnectedTextInputs(target, { nodes, edges }).map((input) => input.text)).toEqual(['first text block', 'second text block'])

    const withPrompt = withConnectedTextPrompts(target, { nodes, edges })
    expect(withPrompt).not.toBe(target)
    expect(withPrompt.prompt).toBe('base frame\n\nfirst text block\n\nsecond text block')
    expect(target.prompt).toBe('base frame')
  })

  it('视频节点同样读取文本正文，并忽略非文本边与非 reference 文本边', () => {
    const target = videoNode('vid', '')
    const text = textNode('t1', 'camera move description')
    const ignoredText = textNode('t2', 'must not append')
    const image = imageNode('img', 'not appended')
    const nodes = [target, text, ignoredText, image]
    const edges = [
      edge('img', 'vid', 0),
      edge('t1', 'vid', 1),
      edge('t2', 'vid', 2, 'character_ref'),
    ]

    expect(withConnectedTextPrompts(target, { nodes, edges }).prompt).toBe('camera move description')
  })
})
