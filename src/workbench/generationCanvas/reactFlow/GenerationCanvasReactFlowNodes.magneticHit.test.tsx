import React from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { toGenerationFlowNode, type GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { GenerationFlowNodeView } from './GenerationCanvasReactFlowNodes'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../nodes/renderRegistry', () => ({
  getGenerationNodeComponentForNode: () => function StubNode() {
    return <div data-stub-node="true" />
  },
}))

function imageNode(id: string, x: number, y = 120): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x, y },
    size: { width: 240, height: 135 },
    meta: { previewHeight: 135, userResized: true },
  }
}

function renderSelectedNodeHandles(nodes: GenerationCanvasNode[], selectedId: string): Record<'left' | 'right', { width?: string; pointerEvents?: string }> {
  const flowNodes = nodes.map((n) => toGenerationFlowNode(n, n.id === selectedId, false, n.id === selectedId))
  const selected = flowNodes.find((n) => n.id === selectedId)!
  const nodeProps = {
    id: selected.id,
    data: selected.data,
    selected: true,
    type: 'generation',
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    isConnectable: true,
    zIndex: 5,
    positionAbsoluteX: selected.position.x,
    positionAbsoluteY: selected.position.y,
    width: selected.width,
    height: selected.height,
  } as unknown as NodeProps<GenerationFlowNode>

  const captured: Array<{ type: string; props: Record<string, unknown> }> = []
  const renderer = createReactTestRenderer({
    createInstance: (type, props) => {
      const instance = { type, props }
      captured.push(instance)
      return instance
    },
    commitUpdate: (instance, props) => {
      instance.props = props
    },
  })
  try {
    renderer.render(
      <ReactFlowProvider initialNodes={flowNodes} initialEdges={[]}>
        <GenerationFlowNodeView {...nodeProps} />
      </ReactFlowProvider>,
    )
    renderer.flushPassiveEffects()
    const result = {} as Record<'left' | 'right', { width?: string; pointerEvents?: string }>
    for (const el of captured) {
      if (el.type !== 'span') continue
      if (typeof el.props.className !== 'string' || !el.props.className.includes('generation-canvas-react-flow__handle-hit')) continue
      const side = el.props['data-side'] as 'left' | 'right' | undefined
      const style = el.props.style as { width?: string; pointerEvents?: string } | undefined
      if (side) result[side] = { width: style?.width, pointerEvents: style?.pointerEvents }
    }
    return result
  } finally {
    renderer.close()
  }
}

describe('GenerationFlowNodeView · 磁吸把手命中带按邻卡间距实得收窄', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('选中卡两侧存在 80px 左邻卡与 64px 右邻卡时，左右 .handle-hit 实际渲染为 66px 与 50px；开阔侧保持 112px', () => {
    const crowded = renderSelectedNodeHandles(
      [imageNode('ref-left', 100), imageNode('main-center', 420), imageNode('derived-right', 724)],
      'main-center',
    )
    expect(crowded.left).toEqual({ width: '66px', pointerEvents: undefined })
    expect(crowded.right).toEqual({ width: '50px', pointerEvents: undefined })

    const open = renderSelectedNodeHandles([imageNode('main-center', 420)], 'main-center')
    expect(open.left).toEqual({ width: '112px', pointerEvents: undefined })
    expect(open.right).toEqual({ width: '112px', pointerEvents: undefined })
  })

  it('邻卡紧贴或重叠时该侧 .handle-hit 收缩为 0px 且关闭 pointer-events，不抢邻卡悬停', () => {
    const touching = renderSelectedNodeHandles(
      [imageNode('touch-left', 175), imageNode('main-center', 420)],
      'main-center',
    )
    expect(touching.left).toEqual({ width: '0px', pointerEvents: 'none' })
    expect(touching.right).toEqual({ width: '112px', pointerEvents: undefined })
  })

  it('全局 CSS 不再把磁吸 .handle-hit 写死成 112px（由组件按实测邻距注入内联宽度）', () => {
    const css = readFileSync(fileURLToPath(new URL('./generationCanvasReactFlow.css', import.meta.url)), 'utf8')
    const rule = css.match(/\.generation-canvas-react-flow__handle--magnetic\s+\.generation-canvas-react-flow__handle-hit\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).not.toMatch(/\bwidth\s*:\s*112px\b/)
  })
})
