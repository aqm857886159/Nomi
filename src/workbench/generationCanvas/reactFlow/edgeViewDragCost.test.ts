import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// 类级检查（逃逸 FB-20261005-01-open-mount 的拖动那一半）：拖动时连到被拖节点的边每帧重渲，
// 边组件在渲染里不许做「按模型档案校验连线模式」这类只依赖两端节点、不依赖坐标的贵派生（全选拖 320 张卡时累计 2.5 秒）。
// 清单：React Flow 的边类型登记表 edgeTypes 里的每一个边组件，逐个在三组坐标下渲染（模拟三帧拖动），
// 菜单没开时一次都不许调 availableEdgeModes。

const calls = vi.hoisted(() => ({ count: 0 }))
vi.mock('../components/edgeModeMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/edgeModeMenu')>()
  return { ...actual, availableEdgeModes: (...args: Parameters<typeof actual.availableEdgeModes>) => { calls.count += 1; return actual.availableEdgeModes(...args) } }
})

const { edgeTypes } = await import('./GenerationCanvasReactFlowNodes')

const sourceNode = { id: 'a', kind: 'image', title: '图 A', position: { x: 0, y: 0 } }
const targetNode = { id: 'b', kind: 'video', title: '视频 B', position: { x: 400, y: 0 } }
const FRAMES = [[0, 0, 400, 0], [12, 7, 412, 7], [40, 22, 440, 22]] as const

describe('edge views do no model/archetype derivation on drag frames', () => {
  for (const [name, EdgeView] of Object.entries(edgeTypes)) {
    it(`${name}: three drag frames, menu closed → availableEdgeModes is never called`, () => {
      calls.count = 0
      for (const [sourceX, sourceY, targetX, targetY] of FRAMES) {
        renderToString(React.createElement(EdgeView as React.ComponentType<Record<string, unknown>>, {
          id: 'e1', source: 'a', target: 'b', sourceX, sourceY, targetX, targetY,
          sourcePosition: 'right', targetPosition: 'left', selected: false,
          data: { generationEdge: { id: 'e1', source: 'a', target: 'b', mode: 'reference' }, sourceNode, targetNode, readOnly: false },
        }))
      }
      expect(calls.count).toBe(0)
    })
  }
})
