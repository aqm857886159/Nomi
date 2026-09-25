import { describe, expect, it, vi } from 'vitest'
import { commitCanvasNodeDragStop, isKeyboardMoveBatch, keyboardMoveScope } from './canvasDragWriteback'
import type { GenerationFlowNode } from './generationCanvasReactFlowAdapter'

vi.mock('../../../ui/toast', () => ({ toast: vi.fn() }))
vi.mock('../../adoption/adoptGenerationNode', () => ({ adoptGenerationNode: vi.fn() }))
vi.mock('../../adoption/adoptionReceipt', () => ({ reportAdoptionOutcome: vi.fn() }))
vi.mock('../../workbenchStore', () => ({ useWorkbenchStore: { getState: vi.fn() } }))
vi.mock('../store/generationCanvasStore', () => ({ useGenerationCanvasStore: { getState: vi.fn() } }))
vi.mock('../events/canvasEventEmitter', () => ({ emitCanvasGesture: vi.fn() }))

describe('cancelled canvas drag writeback', () => {
  it.each([{ readOnly: true, active: true }, { readOnly: false, active: false }])('clears temporary ownership without a successful move for %o', ({ readOnly, active }) => {
    const draggedNode = { id: 'shot', position: { x: 50, y: 20 }, data: {} } as GenerationFlowNode
    const draggingRef = { current: active }
    const dragStartPositionsRef = { current: new Map([['shot', { x: 0, y: 0 }]]) }
    const dragDraftNodesRef = { current: [draggedNode] }
    const moveNode = vi.fn(); const commitPersistedChange = vi.fn()
    commitCanvasNodeDragStop({ event: { clientX: 50, clientY: 20 } as MouseEvent, draggedNode, draggedNodes: [draggedNode], readOnly, t: vi.fn() as never, draggingRef, dragStartPositionsRef, dragDraftNodesRef, moveNode, commitPersistedChange })
    expect(draggingRef.current).toBe(false)
    expect(dragStartPositionsRef.current.size).toBe(0)
    expect(dragDraftNodesRef.current).toEqual([])
    expect(moveNode).not.toHaveBeenCalled()
    expect(commitPersistedChange).not.toHaveBeenCalled()
  })
})

describe('keyboard move scope (arrow-key nudge)', () => {
  it('authorizes exactly the nodes selected when the arrow key went down, regardless of when React Flow applies the move', async () => {
    const scope = keyboardMoveScope({ key: 'ArrowRight' }, ['a', 'b'])
    await Promise.resolve() // the old flag was cleared here, before React Flow applied the move
    expect(isKeyboardMoveBatch([{ nodeId: 'a' }, { nodeId: 'b' }], scope)).toBe(true)
    expect(isKeyboardMoveBatch([{ nodeId: 'a' }, { nodeId: 'c' }], scope)).toBe(false)
  })
  it('other keys, an empty selection or an empty batch authorize nothing', () => {
    expect(keyboardMoveScope({ key: 'a' }, ['a'])).toBeNull()
    expect(keyboardMoveScope({ key: 'ArrowUp' }, [])).toBeNull()
    expect(isKeyboardMoveBatch([], new Set(['a']))).toBe(false)
    expect(isKeyboardMoveBatch([{ nodeId: 'a' }], null)).toBe(false)
  })
})
