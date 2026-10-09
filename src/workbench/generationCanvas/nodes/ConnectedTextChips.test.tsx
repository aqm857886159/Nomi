import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import '../../../i18n'
import { tiptapDocFromPlainText } from '../../../../electron/shared/canvas/textNodeBody'
import type { GenerationCanvasNode, TiptapDocJson } from '../model/generationCanvasTypes'
import { projectConnectedTextInputs, withConnectedTextPrompts } from '../runner/connectedTextPrompt'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import fs from 'node:fs'
import path from 'node:path'
import { ConnectedTextChipList } from './ConnectedTextChips'

const store = () => useGenerationCanvasStore.getState()

function addText(title: string, body: string): GenerationCanvasNode {
  const node = store().addNode({ kind: 'text', title, prompt: '' })
  store().writeNodeBody(node.id, tiptapDocFromPlainText(body) as TiptapDocJson)
  return store().nodes.find((n) => n.id === node.id)!
}

beforeEach(() => store().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] }))

describe('下游输入框的「引用 · 文本名」小签', () => {
  it('小签 = 生成时真会拼进提示词的那几段，顺序一致；执行器拼出的提示词读同一个投影', () => {
    const style = addText('风格说明', '冷色夜景，胶片颗粒')
    const camera = addText('镜头说明', '偏低机位，缓慢推进')
    const video = store().addNode({ kind: 'video', title: '镜 03', prompt: '低机位，怀表落在积水里' })
    store().connectNodes(camera.id, video.id, 'reference', undefined, 1)
    store().connectNodes(style.id, video.id, 'reference', undefined, 0)
    const state = store()
    const target = state.nodes.find((n) => n.id === video.id)!
    const context = { nodes: state.nodes, edges: state.edges }

    const markup = renderToStaticMarkup(<ConnectedTextChipList inputs={projectConnectedTextInputs(target, { nodes: store().nodes, edges: store().edges })} />)
    const shown = [...markup.matchAll(/data-connected-text-chip="([^"]+)"/g)].map((match) => match[1])
    const projected = projectConnectedTextInputs(target, context)
    expect(shown).toEqual(projected.map((input) => input.sourceId))
    expect(shown).toEqual([style.id, camera.id])
    expect(markup).toContain('风格说明')
    expect(markup).toContain('镜头说明')

    // 发出去的提示词 = 节点自己的 + 小签上那几段（同一份文字、同一个顺序）。
    expect(withConnectedTextPrompts(target, context).prompt).toBe(
      ['低机位，怀表落在积水里', ...projected.map((input) => input.text)].join('\n\n'),
    )
  })

  it('小签组件自己不扫边：它的数据只来自 projectConnectedTextInputs', () => {
    const source = fs.readFileSync(path.join(__dirname, 'ConnectedTextChips.tsx'), 'utf8')
    expect(source).toContain('projectConnectedTextInputs(node')
    expect(source).not.toContain('isTextPromptEdge')
    expect(source).not.toContain('.edges.filter')
  })

  it('没有文字连进来：一个小签都不画', () => {
    const video = store().addNode({ kind: 'video', title: '镜 03', prompt: 'p' })
    const target = store().nodes.find((n) => n.id === video.id)!
    expect(renderToStaticMarkup(<ConnectedTextChipList inputs={projectConnectedTextInputs(target, { nodes: store().nodes, edges: store().edges })} />)).toBe('')
  })

  it('正文是空的文本节点不算引用（生成时它不会拼进去，小签也不摆）', () => {
    const empty = store().addNode({ kind: 'text', title: '空的', prompt: '' })
    const video = store().addNode({ kind: 'video', title: '镜', prompt: 'p' })
    store().connectNodes(empty.id, video.id)
    const target = store().nodes.find((n) => n.id === video.id)!
    expect(renderToStaticMarkup(<ConnectedTextChipList inputs={projectConnectedTextInputs(target, { nodes: store().nodes, edges: store().edges })} />)).toBe('')
  })
})
