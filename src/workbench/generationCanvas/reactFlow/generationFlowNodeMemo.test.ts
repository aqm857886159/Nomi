import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { NodeProps } from '@xyflow/react'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'
import { nodeTypes } from './GenerationCanvasReactFlowNodes'
import { POSITION_ONLY_NODE_PROPS, sameGenerationFlowNodeRender } from '../nodes/flowNodeRenderGate'

const here = path.dirname(fileURLToPath(import.meta.url))
const data = { generationNode: { id: 'n1' } } as unknown as GenerationFlowNode['data']
const base = {
  id: 'n1', type: 'generation', data, selected: false, selectable: true, draggable: true, deletable: true,
  isConnectable: true, dragging: false, zIndex: 0, positionAbsoluteX: 10, positionAbsoluteY: 20, width: 300, height: 200,
} as unknown as NodeProps<GenerationFlowNode>

describe('canvas node shell does not re-render while it is only being moved', () => {
  it('a drag frame (only the absolute position changed) keeps the rendered card', () => {
    expect(sameGenerationFlowNodeRender(base, { ...base, positionAbsoluteX: 480, positionAbsoluteY: -35 })).toBe(true)
  })

  it('every other prop still re-renders: data, selection, dragging, size, z-order', () => {
    for (const change of [
      { data: { ...data } }, { selected: true }, { dragging: true }, { width: 301 }, { height: 199 }, { zIndex: 1000 },
      { isConnectable: false }, { draggable: false },
    ]) {
      expect(sameGenerationFlowNodeRender(base, { ...base, ...change } as NodeProps<GenerationFlowNode>)).toBe(false)
    }
    const { width: _width, ...withoutWidth } = base
    expect(sameGenerationFlowNodeRender(base, withoutWidth as NodeProps<GenerationFlowNode>)).toBe(false)
  })

  it('React Flow receives the memoized shell with this comparator', () => {
    const shell = nodeTypes.generation as unknown as { $$typeof: symbol; compare: unknown }
    expect(shell.$$typeof).toBe(Symbol.for('react.memo'))
    expect(shell.compare).toBe(sameGenerationFlowNodeRender)
  })

  it('the shell never reads the ignored position props (else ignoring them would show a stale card)', () => {
    const source = fs.readFileSync(path.join(here, 'GenerationCanvasReactFlowNodes.tsx'), 'utf8')
    const signature = source.match(/export function GenerationFlowNodeView\(\{([^}]*)\}/)
    expect(signature?.[1].split(',').map((part) => part.trim()).filter(Boolean).sort()).toEqual(['data', 'selected'])
    for (const key of POSITION_ONLY_NODE_PROPS) {
      const body = source.slice(source.indexOf('export function GenerationFlowNodeView'), source.indexOf('export function GenerationFlowEdgeView'))
      expect(body.includes(key)).toBe(false)
    }
  })

  it('resize handles exist only on the single selected card, never on every card of a multi-selection', () => {
    const source = fs.readFileSync(path.join(here, 'GenerationCanvasReactFlowNodes.tsx'), 'utf8')
    const resizer = source.slice(source.indexOf('<NodeResizer'), source.indexOf('<NodeResizer') + 200)
    expect(resizer).toMatch(/isVisible=\{data\.primarySelection && /)
  })
})
