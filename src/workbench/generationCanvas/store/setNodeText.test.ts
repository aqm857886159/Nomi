import { beforeEach, describe, expect, it } from 'vitest'

import { textNodeBody, tiptapDocFromPlainText } from '../../../../electron/shared/canvas/textNodeBody'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import type { TiptapDocJson } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from './generationCanvasStore'

const store = () => useGenerationCanvasStore.getState()
const bodyOf = (id: string) => textNodeBody(store().nodes.find((node) => node.id === id)!)

beforeEach(() => {
  store().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
})

describe('文本节点正文唯一写口 writeNodeBody / setNodeText', () => {
  it('setNodeText 是一个画布撤销步：撤销后正文回到原样，重做回到新样', () => {
    const node = store().addNode({ kind: 'text', title: 't', prompt: '' })
    store().writeNodeBody(node.id, tiptapDocFromPlainText('原文') as TiptapDocJson)
    store().setNodeText(node.id, 'Agent 写的')
    expect(bodyOf(node.id)).toBe('Agent 写的')
    store().undo()
    expect(bodyOf(node.id)).toBe('原文')
    store().redo()
    expect(bodyOf(node.id)).toBe('Agent 写的')
  })

  it('编辑器手改（persist:false、无撤销点）不进画布撤销栈，也不消耗持久化修订号', () => {
    const node = store().addNode({ kind: 'text', title: 't', prompt: '' })
    const revision = store().persistRevision
    store().writeNodeBody(node.id, tiptapDocFromPlainText('打字中') as TiptapDocJson, { persist: false })
    expect(bodyOf(node.id)).toBe('打字中')
    expect(store().persistRevision).toBe(revision)
  })

  it('append 在空正文上等同 replace，不留空段落', () => {
    const node = store().addNode({ kind: 'text', title: 't', prompt: '' })
    store().setNodeText(node.id, '新的', 'append')
    expect(bodyOf(node.id)).toBe('新的')
    expect(store().nodes[0]!.contentJson?.content).toHaveLength(1)
  })
})
