// 列表与画布只有一份数据：检查器里的生成框（现役 NodeGenerationComposer，host="inline"，与画布同一个组件、同一套排版）写进去的，
// 就是画布 store 里那个节点；列表卡读回来的也是它。这里把生成框换成一个探针，只为拿到它**真正拿到的写口**
// （useNodeWriteAccess）——检查器若包一层自己的 NodeWriteAccessProvider（第二份账本），这条就红。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MantineProvider } from '@mantine/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useNodeWriteAccess, type NodeWriteAccess } from '../../generationCanvas/nodes/nodeWriteAccess'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { deriveGenerationList } from './generationListModel'

vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const probe: { access: NodeWriteAccess | null; host: string | null; nodeId: string | null } = { access: null, host: null, nodeId: null }
vi.mock('../../generationCanvas/nodes/LazyNodeGenerationComposer', () => ({
  default: function ComposerProbe(props: { node: GenerationCanvasNode; host?: string }) {
    probe.access = useNodeWriteAccess()
    probe.host = props.host ?? null
    probe.nodeId = props.node.id
    return null
  },
}))

const shot: GenerationCanvasNode = {
  id: 'shot-1', kind: 'image', title: 'Shot', prompt: 'before', position: { x: 0, y: 0 }, status: 'idle', categoryId: 'shots',
  meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', aspect_ratio: '16:9' },
} as GenerationCanvasNode

beforeEach(() => {
  probe.access = null
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [shot], edges: [], groups: [], selectedNodeIds: [] })
})

describe('list and canvas share one data source', () => {
  it('the inspector composer writes straight into the canvas node, and the list card reads the change back', async () => {
    const { GenerationListDetail } = await import('./GenerationListDetail')
    const model = () => {
      const state = useGenerationCanvasStore.getState()
      return deriveGenerationList({ nodes: state.nodes, edges: state.edges, groups: state.groups, designsByDocumentId: {}, imageModelOptions: [], videoModelOptions: [] })
    }
    const card = model().sections[0].cards[0]
    // 静态渲染读的是 store 的「服务端快照」（zustand 4 = getInitialState 那个对象）；让它此刻就是这张画布，
    // 渲染里读到的才是同一个节点。渲染完还原。
    const serverSnapshot = useGenerationCanvasStore.getInitialState() as unknown as Record<string, unknown>
    const savedNodes = serverSnapshot.nodes
    serverSnapshot.nodes = useGenerationCanvasStore.getState().nodes
    renderToStaticMarkup(React.createElement(MantineProvider, null, React.createElement(GenerationListDetail, { card, onBack: () => undefined })))
    serverSnapshot.nodes = savedNodes
    expect(probe.nodeId).toBe('shot-1')
    expect(probe.host).toBe('inline')
    // 生成框拿到的写口 = 画布 store；写一笔参数和提示词。
    probe.access!.updateNode('shot-1', { prompt: 'after', meta: { ...shot.meta, aspect_ratio: '9:16' } })
    const canvasNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'shot-1')!
    expect(canvasNode.prompt).toBe('after')
    expect(canvasNode.meta?.aspect_ratio).toBe('9:16')
    // 列表投影里那张卡就是这个节点（同一个 id，没有副本）。
    expect(model().sections[0].cards[0].nodeId).toBe('shot-1')
    expect(probe.access!.latestNode('shot-1')).toBe(canvasNode)
  })
})
