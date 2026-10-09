import React from 'react'
import { renderToString } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'

// 类级检查（逃逸 FB-20261005-01-open-mount 的拖动那一半）：拖动时连到被拖节点的边每帧重渲，
// 边组件在渲染里不许做「按模型档案校验连线」这类只依赖两端节点、不依赖坐标的贵派生（全选拖 320 张卡时累计 2.5 秒）。
// 清单：React Flow 的边类型登记表 edgeTypes 里的每一个边组件，逐个在三组坐标下渲染（模拟三帧拖动），一次都不许碰档案校验。
//
// 2026-10-08 用户「删掉连线中间的标签吗，没有作用」：连线中点的模式胶囊与菜单（那条贵派生 availableEdgeModes 的唯一读者）整体删除，
// 贵派生从结构上不存在了；这条检查继续钉住「边组件不调档案校验」，并加一条：连线上没有模式胶囊 / 菜单。

const calls = vi.hoisted(() => ({ count: 0 }))
vi.mock('../agent/referenceEdgeCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/referenceEdgeCapability')>()
  return {
    ...actual,
    validateReferenceEdge: (...args: Parameters<typeof actual.validateReferenceEdge>) => { calls.count += 1; return actual.validateReferenceEdge(...args) },
    archetypeForNode: (...args: Parameters<typeof actual.archetypeForNode>) => { calls.count += 1; return actual.archetypeForNode(...args) },
  }
})

const { edgeTypes } = await import('./GenerationCanvasReactFlowNodes')

const sourceNode = { id: 'a', kind: 'image', title: '图 A', position: { x: 0, y: 0 } }
const targetNode = { id: 'b', kind: 'video', title: '视频 B', position: { x: 400, y: 0 } }
const FRAMES = [[0, 0, 400, 0], [12, 7, 412, 7], [40, 22, 440, 22]] as const

function render(EdgeView: unknown, props: { sourceX: number; sourceY: number; targetX: number; targetY: number; selected: boolean; mode: string }): string {
  return renderToString(React.createElement(ReactFlowProvider, null, React.createElement(EdgeView as React.ComponentType<Record<string, unknown>>, {
    id: 'e1', source: 'a', target: 'b', sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY,
    sourcePosition: 'right', targetPosition: 'left', selected: props.selected,
    data: { generationEdge: { id: 'e1', source: 'a', target: 'b', mode: props.mode }, sourceNode, targetNode, readOnly: false, incident: true },
  })))
}

describe('edge views', () => {
  for (const [name, EdgeView] of Object.entries(edgeTypes)) {
    it(`${name}: three drag frames → never validates against the model archetype`, () => {
      calls.count = 0
      for (const [sourceX, sourceY, targetX, targetY] of FRAMES) render(EdgeView, { sourceX, sourceY, targetX, targetY, selected: false, mode: 'reference' })
      expect(calls.count).toBe(0)
    })

    for (const mode of ['reference', 'first_frame', 'style_ref']) {
      it(`${name} (${mode}, selected): no mode pill, no mode menu`, () => {
        const html = render(EdgeView, { sourceX: 0, sourceY: 0, targetX: 400, targetY: 0, selected: true, mode })
        expect(html).toContain('generation-canvas-v2__edge-hit')
        expect(html).not.toContain('edge-tag-pill')
        expect(html).not.toContain('edge-menu')
        expect(html).not.toContain('aria-haspopup')
      })
    }
  }
})
