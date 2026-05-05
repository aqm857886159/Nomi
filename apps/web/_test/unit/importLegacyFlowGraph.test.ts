import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { importLegacyFlowGraph } from '../../src/workbench/generationCanvasV2/model/importLegacyFlowGraph'

describe('importLegacyFlowGraph', () => {
  it('converts legacy image and video results into V2 generation nodes', () => {
    const nodes: Array<Node<Record<string, unknown>>> = [
      {
        id: 'legacy-text',
        type: 'taskNode',
        position: { x: 10, y: 20 },
        data: { kind: 'text', label: '脚本', prompt: '第一幕' },
      },
      {
        id: 'legacy-image',
        type: 'taskNode',
        position: { x: 300, y: 20 },
        data: { kind: 'image', label: '图像', imageResults: [{ url: 'https://cdn.test/image.png' }] },
      },
      {
        id: 'legacy-video',
        type: 'taskNode',
        position: { x: 620, y: 20 },
        data: { kind: 'video', label: '视频', videoUrl: 'https://cdn.test/video.mp4' },
      },
      {
        id: 'legacy-group',
        type: 'groupNode',
        position: { x: 0, y: 0 },
        data: { label: '分组' },
      },
    ]
    const edges: Array<Edge<Record<string, unknown>>> = [
      { id: 'edge-1', source: 'legacy-text', target: 'legacy-image' },
      { id: 'edge-2', source: 'legacy-image', target: 'legacy-video' },
      { id: 'edge-dropped', source: 'legacy-group', target: 'legacy-video' },
    ]

    const snapshot = importLegacyFlowGraph({ nodes, edges })

    expect(snapshot.nodes.map((node) => node.id)).toEqual(['legacy-text', 'legacy-image', 'legacy-video'])
    expect(snapshot.nodes.find((node) => node.id === 'legacy-image')?.result?.url).toBe('https://cdn.test/image.png')
    expect(snapshot.nodes.find((node) => node.id === 'legacy-video')?.result?.type).toBe('video')
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(['edge-1', 'edge-2'])
  })

  it('normalizes unsupported legacy kinds to text instead of inventing a model-specific node', () => {
    const snapshot = importLegacyFlowGraph({
      nodes: [
        {
          id: 'legacy-unknown',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: { kind: 'vendorSpecificKind', label: '未知', content: '保留文本' },
        },
      ],
      edges: [],
    })

    expect(snapshot.nodes[0]?.kind).toBe('text')
    expect(snapshot.nodes[0]?.prompt).toBe('保留文本')
  })

  it('maps legacy aliases, prompt fields, sizes, and fallback ids through the V2 node contract', () => {
    const snapshot = importLegacyFlowGraph({
      nodes: [
        {
          id: '',
          type: 'taskNode',
          position: { x: 10.4, y: 20.6 },
          style: { width: '199', height: '80' },
          data: {
            kind: 'composeVideo',
            name: '合成视频',
            storyboard: '镜头脚本',
            videoResults: [{ url: '' }, { url: 'https://cdn.test/composed.mp4' }],
          },
        },
        {
          id: 'storyboard-node',
          type: 'taskNode',
          position: { x: 30, y: 40 },
          width: 360.8,
          height: 190.2,
          data: {
            kind: 'storyboard',
            title: '分镜图',
            text: '画面文本',
            url: 'https://cdn.test/storyboard.png',
          },
        },
        {
          id: 'io-node',
          type: 'ioNode',
          position: { x: 0, y: 0 },
          data: { label: '输入输出' },
        },
      ],
      edges: [
        { id: '', source: 'legacy-flow-node-1', target: 'storyboard-node' },
        { id: 'dropped-io-edge', source: 'storyboard-node', target: 'io-node' },
      ],
    })

    expect(snapshot.nodes).toEqual([
      expect.objectContaining({
        id: 'legacy-flow-node-1',
        kind: 'video',
        title: '合成视频',
        prompt: '镜头脚本',
        position: { x: 10, y: 21 },
        size: { width: 220, height: 120 },
        status: 'success',
        result: expect.objectContaining({ type: 'video', url: 'https://cdn.test/composed.mp4' }),
      }),
      expect.objectContaining({
        id: 'storyboard-node',
        kind: 'image',
        title: '分镜图',
        prompt: '画面文本',
        size: { width: 361, height: 190 },
        result: expect.objectContaining({ type: 'image', url: 'https://cdn.test/storyboard.png' }),
      }),
    ])
    expect(snapshot.edges).toEqual([
      { id: 'legacy-flow-edge-1', source: 'legacy-flow-node-1', target: 'storyboard-node' },
    ])
  })
})
