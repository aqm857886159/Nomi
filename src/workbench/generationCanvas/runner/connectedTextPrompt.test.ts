import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { collectConnectedTextPromptParts, withConnectedTextPrompts } from './connectedTextPrompt'

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

function edge(source: string, target: string, order: number): GenerationCanvasEdge {
  return { id: `${source}-${target}`, source, target, mode: 'reference', order } as GenerationCanvasEdge
}

describe('connected text prompt context', () => {
  it('appends linked text node bodies to an image prompt by edge order without mutating the node', () => {
    const target = imageNode('img', 'base frame')
    const first = textNode('t1', 'first text block')
    const second = textNode('t2', 'second text block')
    const nodes = [target, first, second]
    const edges = [edge('t2', 'img', 1), edge('t1', 'img', 0)]

    expect(collectConnectedTextPromptParts(target, { nodes, edges })).toEqual(['first text block', 'second text block'])

    const withPrompt = withConnectedTextPrompts(target, { nodes, edges })
    expect(withPrompt).not.toBe(target)
    expect(withPrompt.prompt).toBe('base frame\n\nfirst text block\n\nsecond text block')
    expect(target.prompt).toBe('base frame')
  })

  it('uses linked text bodies for video nodes and ignores non-text edges', () => {
    const target = videoNode('vid', '')
    const text = textNode('t1', 'camera move description')
    const image = imageNode('img', 'not appended')
    const nodes = [target, text, image]
    const edges = [edge('img', 'vid', 0), edge('t1', 'vid', 1)]

    expect(withConnectedTextPrompts(target, { nodes, edges }).prompt).toBe('camera move description')
  })
})
