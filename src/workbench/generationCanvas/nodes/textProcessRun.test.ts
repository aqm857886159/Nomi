import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tiptapDocFromPlainText } from '../../../../electron/shared/canvas/textNodeBody'
import type { GenerationCanvasNode, TiptapDocJson } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const started = vi.hoisted(() => ({ calls: [] as Array<{ id: string; preset: unknown }> }))
vi.mock('./composerRun', () => ({
  startGenerationFromComposer: async (node: GenerationCanvasNode) => { started.calls.push({ id: node.id, preset: node.meta?.textGenPreset }) },
}))

import { runTextPreset } from './textProcessRun'

const store = () => useGenerationCanvasStore.getState()
const messages: string[] = []
const present = (message: string) => { messages.push(message) }

function addText(body: string): GenerationCanvasNode {
  const node = store().addNode({ kind: 'text', title: '风格说明', prompt: '' })
  if (body) store().writeNodeBody(node.id, tiptapDocFromPlainText(body) as TiptapDocJson)
  return store().nodes.find((n) => n.id === node.id)!
}

beforeEach(() => {
  store().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  started.calls.length = 0
  messages.length = 0
})

describe('点加工预设：先看有没有东西可加工，再走和 ↑ 同一条生成路径', () => {
  it('有正文：把预设写到节点上并开始生成', () => {
    const node = addText('雨夜便利店')
    runTextPreset(node.id, 'expand', present)
    expect(started.calls).toEqual([{ id: node.id, preset: 'expand' }])
    expect(store().nodes.find((n) => n.id === node.id)!.meta?.textGenPreset).toBe('expand')
    expect(messages).toEqual([])
  })

  it('空节点点「扩写」：当场说缺什么，不开始、不留预设', () => {
    const node = addText('')
    runTextPreset(node.id, 'expand', present)
    expect(started.calls).toEqual([])
    expect(messages).toHaveLength(1)
    expect(store().nodes.find((n) => n.id === node.id)!.meta?.textGenPreset).toBeUndefined()
  })

  it('看图写描述：没连图说缺图；连了图才开始', () => {
    const node = addText('')
    runTextPreset(node.id, 'describe', present)
    expect(started.calls).toEqual([])
    expect(messages).toHaveLength(1)
    const image = store().addNode({ kind: 'image', title: '林薇', prompt: '' })
    store().updateNode(image.id, { result: { id: 'r', type: 'image', url: 'https://x/a.png' } as never })
    store().connectNodes(image.id, node.id)
    runTextPreset(node.id, 'describe', present)
    expect(started.calls).toEqual([{ id: node.id, preset: 'describe' }])
  })

  it('锁定的节点：什么都不做', () => {
    const node = addText('有字')
    store().setNodeLocked(node.id, true)
    runTextPreset(node.id, 'translate', present)
    expect(started.calls).toEqual([])
    expect(messages).toEqual([])
  })
})
