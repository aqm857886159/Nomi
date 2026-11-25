import React from 'react'
import { ReactFlowProvider, type NodeResizerProps } from '@xyflow/react'
import { createReactTestRenderer } from '../../ai/v4/testReactRenderer'
import { beginCanvasDragging, CANVAS_DRAGGING_OWNER } from '../components/canvasDraggingFlag'
import { commitCanvasNodeDragStop } from '../reactFlow/canvasDragWriteback'
import { toGenerationFlowNode } from '../reactFlow/generationCanvasReactFlowAdapter'
import { GenerationFlowNodeView } from '../reactFlow/GenerationCanvasReactFlowNodes'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendEvents, readEvents, resetEventLogStateForTests, setEventLogProjectDirResolverForTests } from '../../../../electron/events/eventLogRepository'
import { replayCanvasEventTailAndSealGenesis } from '../../project/workbenchProjectSession'
import { createDefaultWorkbenchProjectPayload } from '../../project/projectRecordSchema'
import { applyProposalBatch } from '../agent/proposalTxn'
import { setCommittedProposal, clearCommittedProposal, runProposalUndoByChangeId } from '../agent/proposalUndo'
import { makeChangeId } from '../../../../electron/shared/agentCapabilities/changeId'
import { describe, expect, it, vi } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { inspectCanvasPatchHistory, getUndoHeadToken, getUndoJournalGeneration, readReachableUndoNodes, registerUndoHistoryEvictionHandler } from '../events/canvasPatchHistory'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } }))

const resize = vi.hoisted(() => ({ props: undefined as NodeResizerProps | undefined }))
vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  NodeResizer: (props: NodeResizerProps) => { resize.props = props; return null },
}))
vi.mock('../nodes/renderRegistry', () => ({ getGenerationNodeComponentForNode: () => () => null }))

const canvas = useGenerationCanvasStore.getState
const shot = (id: string): GenerationCanvasNode => ({
  id, title: id, kind: 'image', position: { x: 100, y: 50 }, prompt: 'original', meta: { aspectRatio: '16:9' },
})
const open = (projectId = 'history-a') => canvas().restoreSnapshot({ nodes: [shot('paid'), shot('other')], groups: [], edges: [] }, projectId)
const node = (id: string) => canvas().nodes.find(candidate => candidate.id === id)
const editPrompt = (prompt: string) => canvas().updateNodes([{ nodeId: 'paid', patch: { prompt } }])
const result: GenerationNodeResult = {
  id: 'render', assetId: 'asset-render', taskId: 'vendor-job', type: 'image', url: 'nomi-local://render.png', createdAt: 20,
}

describe('Canvas history at the user write boundary', () => {
  it('undoes ten edits while keeping the later paid delivery bound to its original run and asset', async () => {
    open()
    canvas().appendNodeRun('paid', { id: 'run-paid', status: 'running', projectId: 'history-a', startedAt: 10 })
    for (let step = 1; step <= 6; step++) editPrompt('draft ' + step)
    canvas().updateNode('paid', { meta: { aspectRatio: '1:1' } })
    canvas().captureHistory()
    canvas().moveNode('paid', { x: 451, y: 82 })
    canvas().startConnection('other')
    canvas().connectToNode('paid')
    expect(canvas().edges).toHaveLength(1)
    canvas().deleteNode('other')
    const head = getUndoHeadToken()
    await Promise.resolve()
    canvas().addNodeResult('paid', result, { width: 1200, height: 800 }, 'run-paid')
    expect(getUndoHeadToken()).not.toBe(head)
    const landed = node('paid')!
    expect(landed.runs).toMatchObject([{ id: 'run-paid', resultId: result.id, taskId: result.taskId, assetId: result.assetId, status: 'success' }])
    for (let step = 1; step <= 10; step++) {
      expect(canvas().canUndo).toBe(true)
      canvas().undo()
      expect(node('paid')).toMatchObject({
        result: landed.result, history: [landed.result], resultVersionMax: 1, runs: landed.runs,
        status: 'success', meta: { imageWidth: 1200, imageHeight: 800 },
        position: step < 3 ? { x: 451, y: 82 } : shot('paid').position,
        prompt: step < 5 ? 'draft 6' : step === 10 ? 'original' : 'draft ' + (10 - step),
      })
      expect(node('other')).toBeDefined()
      expect(canvas().edges).toHaveLength(step === 1 ? 1 : 0)
    }
    expect(node('paid')?.meta?.aspectRatio).toBe('16:9')
    expect(canvas().canUndo).toBe(false)
  })

  it('notifies the asset owner when a fresh edit discards a reachable redo branch below capacity', () => {
    open()
    const future = canvas().addNode({ kind: 'image', title: 'A removable reference' })
    canvas().updateNode(future.id, { result, history: [result] }, { history: false })
    canvas().undo()
    const reachable = () => [...readReachableUndoNodes()].some(frame => frame.nodes.some(item => item.result?.assetId === result.assetId))
    expect(node(future.id)).toBeUndefined()
    expect(reachable()).toBe(true)
    expect(canvas().canRedo).toBe(true)
    const evicted = vi.fn()
    const unsubscribe = registerUndoHistoryEvictionHandler(evicted)
    try {
      editPrompt('branch')
      expect(canvas().canRedo).toBe(false)
      expect(evicted).toHaveBeenCalledTimes(1)
      expect(reachable()).toBe(false)
      expect(evicted.mock.calls[0][0]).toMatchObject({ generation: getUndoJournalGeneration() })
    } finally { unsubscribe() }
  })

  it('retains exactly eighty edits and signals the first eviction on edit eighty-one', () => {
    open()
    const evicted = vi.fn()
    const unsubscribe = registerUndoHistoryEvictionHandler(evicted)
    try {
      for (let step = 1; step <= 80; step++) editPrompt('draft ' + step)
      expect(evicted).toHaveBeenCalledTimes(0)
      editPrompt('draft 81')
      expect(evicted).toHaveBeenCalledTimes(1)
      for (let step = 0; step < 80; step++) canvas().undo()
      expect(node('paid')?.prompt).toBe('draft 1')
      expect(canvas().canUndo).toBe(false)
    } finally { unsubscribe() }
  })

  it('invalidates undo, redo and stale head tokens across A → B → A', () => {
    open()
    editPrompt('project A')
    canvas().undo()
    const head = getUndoHeadToken()
    open('history-b')
    expect(canvas()).toMatchObject({ canRedo: false, canUndo: false })
    editPrompt('project B')
    open()
    expect(getUndoHeadToken()).not.toBe(head)
    canvas().undo()
    canvas().redo()
    expect(node('paid')?.prompt).toBe('original')
    expect(canvas()).toMatchObject({ canRedo: false, canUndo: false })
  })
})

describe('creation, deletion and proposal ownership', () => {
  it.each(['manual', 'proposal', 'duplicate group'] as const)('%s keeps only the newly created container that receives a result', async kind => {
    open()
    const previous = new Set(canvas().nodes.map(item => item.id))
    if (kind === 'manual') canvas().addNode({ kind: 'image', title: 'New shot' })
    if (kind === 'proposal') {
      const outcome = await applyProposalBatch([{
        toolCallId: 'create-batch', toolName: 'create_canvas_nodes',
        effectiveArgs: { nodes: ['first', 'second'].map(clientId => ({ clientId, kind: 'image', title: clientId })) },
      }])
      expect(outcome.status).toBe('committed')
    }
    if (kind === 'duplicate group') {
      canvas().startConnection('other')
      canvas().connectToNode('paid')
      const group = canvas().createGroup('shots', 'original', { nodeIds: ['other', 'paid'] })
      if (!group) throw new Error('source group missing')
      expect(canvas().duplicateGroupForDrag(group.id)).toBeTruthy()
    }
    const added = canvas().nodes.filter(item => !previous.has(item.id))
    expect(added).toHaveLength(kind === 'manual' ? 1 : 2)
    const target = added[0].id
    canvas().addNodeResult(target, result)
    canvas().undo()
    expect(canvas().nodes.map(item => item.id).sort()).toEqual([...previous, target].sort())
    expect(node(target)).toMatchObject({ result, history: [result] })
    expect(node(target)?.groupId).toBeUndefined()
    const surviving = new Set(canvas().nodes.map(item => item.id))
    expect(canvas().edges.every(edge => surviving.has(edge.source) && surviving.has(edge.target))).toBe(true)
    expect(canvas().groups.every(group => group.nodeIds.every(id => surviving.has(id)))).toBe(true)
    canvas().redo()
    expect(canvas().nodes.filter(item => item.id === target)).toHaveLength(1)
    expect(node(target)?.history).toHaveLength(1)
  })

  it('restores a deleted result and claims the outcome held during absence exactly once', () => {
    open()
    canvas().addNodeResult('paid', result)
    canvas().deleteNode('paid')
    const late = { ...result, id: 'second', assetId: 'second-asset', createdAt: 30 }
    canvas().holdRunOutcome('paid', { kind: 'result', result: late })
    for (let cycle = 0; cycle < 2; cycle++) {
      canvas().undo()
      expect(node('paid')?.history).toMatchObject([late, result])
      expect(canvas().heldNodeOutcomes.paid).toBeUndefined()
      canvas().redo()
      expect(node('paid')).toBeUndefined()
    }
  })

  it('lets a user take over an uncommitted proposal without a partial redo step', async () => {
    open()
    const pending = applyProposalBatch([{
      toolCallId: 'pending', toolName: 'set_node_prompt', effectiveArgs: { nodeId: 'paid', prompt: 'partial' },
    }])
    expect(node('paid')?.prompt).toBe('partial')
    editPrompt('manual takeover')
    expect((await pending).status).toBe('aborted')
    expect(node('paid')?.prompt).toBe('manual takeover')
    canvas().undo()
    expect(node('paid')?.prompt).toBe('original')
    expect(canvas().canUndo).toBe(false)
    canvas().redo()
    expect(node('paid')?.prompt).toBe('manual takeover')
  })

  it.each(['paid', 'other'])('changeId compensation respects a subsequent edit on %s', async editedId => {
    open()
    const applied = await applyProposalBatch([{
      toolName: 'set_node_prompt', toolCallId: 'patch-prompt', effectiveArgs: { nodeId: 'paid', prompt: 'proposal' },
    }])
    if (applied.status !== 'committed') throw new Error(applied.status)
    const changeId = makeChangeId('canvas', applied.proposalId)
    setCommittedProposal({
      proposalId: applied.proposalId, compensation: applied.compensation, watchNodes: applied.watchNodes,
      summary: 'set prompt', stepLabels: ['set prompt'], reconciliationOk: applied.reconciliation.ok,
    })
    try {
      canvas().updateNodePrompt(editedId, 'hand edit')
      if (editedId === 'paid') expect(() => runProposalUndoByChangeId(changeId)).toThrow(/undo_conflict/)
      else {
        runProposalUndoByChangeId(changeId)
        expect(node('paid')?.prompt).toBe('original')
      }
      expect(node(editedId)?.prompt).toBe('hand edit')
    } finally { clearCommittedProposal() }
  })
})

describe('reopening the disk event stream', () => {
  it.each([0, 1])('uses the opened state as the first undo target at snapshot seq %i', async seq => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-history-events-'))
    const project = 'history-a'
    const tail = 'large prompt '.repeat(600)
    setEventLogProjectDirResolverForTests(() => root)
    try {
      appendEvents(project, ['covered', tail].map(prompt => ({
        id: crypto.randomUUID(), source: 'user', type: 'canvas.node.prompt-changed', payload: { nodeId: 'paid', prompt },
      })))
      const log = path.join(root, '.nomi', 'events', 'log-0.jsonl')
      expect(fs.readFileSync(log, 'utf8')).toContain('"truncated":true')
      fs.appendFileSync(log, '{"v":1,"seq":3')
      const read = vi.fn(async (id: string, fromSeq: number) => ({ events: readEvents(id, { fromSeq }) }))
      vi.stubGlobal('window', { nomiDesktop: { events: { read } } })
      open(project)
      await replayCanvasEventTailAndSealGenesis(project, { ...createDefaultWorkbenchProjectPayload(), generationCanvasLastSeq: seq }, {
        signal: new AbortController().signal, assertCurrent: () => {},
      })
      expect(read).toHaveBeenCalledTimes(seq)
      expect(node('paid')?.prompt).toBe(seq ? tail : 'original')
      expect(canvas().canUndo).toBe(false)
      const opened = canvas().readDocumentSnapshot()
      editPrompt('after open')
      canvas().undo()
      expect(canvas().readDocumentSnapshot()).toEqual(opened)
      expect(Object.keys(opened).sort()).toEqual(['edges', 'groups', 'nodes', 'workflowTemplates'])
    } finally {
      vi.unstubAllGlobals()
      resetEventLogStateForTests()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('React Flow resize history', () => {
  it.each(['continuous', 'zero displacement'] as const)('commits %s resizing only on release', gesture => {
    open()
    editPrompt('future')
    canvas().undo()
    const flowNode = toGenerationFlowNode(node('paid')!, true, false)
    const renderer = createReactTestRenderer()
    const view = React.createElement(GenerationFlowNodeView, {
      ...flowNode, type: 'generation', dragging: false, selected: true, draggable: true,
      selectable: true, deletable: true, isConnectable: true, zIndex: 1,
      positionAbsoluteX: flowNode.position.x, positionAbsoluteY: flowNode.position.y,
    })
    resize.props = undefined
    try {
      renderer.render(React.createElement(ReactFlowProvider, { initialNodes: [flowNode], children: view }))
      renderer.flushPassiveEffects()
      const props = resize.props as NodeResizerProps | undefined
      if (!props?.onResizeStart || !props.onResize || !props.onResizeEnd) throw new Error('missing Canvas resize callbacks')
      const geometry = { ...flowNode.position, width: flowNode.width!, height: flowNode.height! }
      const event = { sourceEvent: { type: 'mousemove' } } as Parameters<typeof props.onResize>[0]
      props.onResizeStart(event, geometry)
      const inProgress = []
      for (let delta = 1; delta <= 20; delta++) {
        props.onResize(event, { ...geometry, width: geometry.width + delta, direction: [1, 0] })
        inProgress.push(canvas().canUndo)
      }
      if (gesture === 'zero displacement') props.onResize(event, { ...geometry, direction: [-1, 0] })
      const width = geometry.width + (gesture === 'continuous' ? 20 : 0)
      props.onResizeEnd(event, { ...geometry, width })
      if (gesture === 'zero displacement') {
        expect(canvas()).toMatchObject({ canUndo: false, canRedo: true })
        canvas().redo()
        expect(node('paid')?.prompt).toBe('future')
      } else {
        expect.soft(inProgress.some(Boolean), 'undo became available before release').toBe(false)
        expect(node('paid')?.size?.width).toBe(width)
        expect(canvas().canUndo).toBe(true)
        canvas().undo()
        expect(canvas().canUndo).toBe(false)
        expect(toGenerationFlowNode(node('paid')!, true, false).width).toBe(geometry.width)
      }
    } finally {
      renderer.close()
      resize.props = undefined
    }
  })
})

it('ignores Escape during a node drag and commits once on release, undoable', () => {
  open()
  const original = node('paid')!.position
  const draggedNode = { ...toGenerationFlowNode(node('paid')!, true, false), position: { x: 310, y: 96 } }
  const draggingRef = { current: true }
  const commitPersistedChange = vi.fn(canvas().commitPersistedChange)
  const stage = { closest: (selector: string) => selector.includes('false') ? null : stage, contains: () => true, getAttribute: () => null, setAttribute() {}, removeAttribute() {} } as unknown as Element
  const host = new EventTarget()
  vi.stubGlobal('window', host)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { elementsFromPoint: () => [], querySelector: () => stage }))
  const lease = beginCanvasDragging(stage, CANVAS_DRAGGING_OWNER.reactFlowNode, {
    onCancel: () => { draggingRef.current = false },
  })
  try {
    host.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }))
    expect(draggingRef.current).toBe(true)
    expect(node('paid')?.position).toEqual(original)
    expect(canvas().canUndo).toBe(false)
    expect(commitPersistedChange).not.toHaveBeenCalled()
    commitCanvasNodeDragStop({
      event: { clientX: 20, clientY: 20 } as MouseEvent, draggedNode, draggedNodes: [draggedNode],
      readOnly: false, t: vi.fn() as never, draggingRef, dragDraftNodesRef: { current: [draggedNode] },
      dragStartPositionsRef: { current: new Map([['paid', original]]) },
      moveNode: canvas().moveNode, commitPersistedChange,
    })
    expect(commitPersistedChange).toHaveBeenCalledTimes(1)
    expect(node('paid')?.position).toEqual(draggedNode.position)
    expect(canvas().canUndo).toBe(true)
    canvas().undo()
    expect(node('paid')?.position).toEqual(original)
    expect(canvas()).toMatchObject({ canUndo: false, canRedo: true })
  } finally { lease.release(); vi.unstubAllGlobals() }
})

it.each([20, 200, 1600])('single-step Undo reads zero unrelated entries after %i edits', count => {
  open()
  for (let i = 0; i < count; i++) editPrompt(String(i))
  const { undo } = inspectCanvasPatchHistory()
  let prefixReads = 0
  const originals = undo.slice(0, -1)
  originals.forEach((step, index) => Object.defineProperty(undo, index, {
    configurable: true, get() { prefixReads++; return step },
  }))
  try {
    canvas().undo()
    expect(node('paid')?.prompt).toBe(String(count - 2))
    expect(prefixReads).toBe(0)
  } finally {
    originals.forEach((step, index) => Object.defineProperty(undo, index, { configurable: true, writable: true, value: step }))
  }
})

it('bounds actual move patch bytes and drops every project recovery index on release', () => {
  const nodes = Array.from({ length: 200 }, (_, index) => shot('shot-' + index))
  canvas().restoreSnapshot({ nodes, edges: [], groups: [] })
  const bytes = (entry: unknown) => Buffer.byteLength(JSON.stringify(entry, (_key, value) => value instanceof Set ? [...value] : value))
  for (let step = 1; step <= 81; step++) {
    const size = step === 1 ? 1 : 20
    canvas().updateNodes(nodes.slice(0, size).map(item => ({ nodeId: item.id, patch: { position: { x: step, y: 50 } } })))
    expect(bytes(inspectCanvasPatchHistory().undo.at(-1))).toBeLessThanOrEqual(size === 1 ? 1024 : 8192)
  }
  expect(bytes(inspectCanvasPatchHistory().undo)).toBeLessThanOrEqual(640 * 1024)
  open('next-project')
  expect(inspectCanvasPatchHistory()).toEqual({ undo: [], redo: [], indexedNodes: 0, receipts: 0, hasCapture: false })
})

it('keeps one shared recovery reference per bulk-deleted node until its step is evicted', () => {
  const nodes = Array.from({ length: 200 }, (_, i) => ({ ...shot('bulk-' + i), prompt: 'long text '.repeat(500) }))
  canvas().restoreSnapshot({ nodes, edges: [], groups: [] })
  const originals = canvas().nodes
  canvas().selectAllNodes()
  canvas().deleteSelectedNodes()
  expect(canvas().nodes).toHaveLength(0)
  const deleted = inspectCanvasPatchHistory().undo.at(-1)!.batches.flat().flatMap(batch => batch.removed)
  expect(deleted).toHaveLength(200)
  deleted.forEach((item, index) => expect(item.entity).toBe(originals[index]))
  canvas().undo()
  expect(canvas().nodes.map(n => n.prompt)).toEqual(originals.map(n => n.prompt))
  canvas().redo()
  for (let i = 0; i < 80; i++) canvas().captureHistory()
  expect(inspectCanvasPatchHistory().indexedNodes).toBe(0)
})

it('starts a fresh typing burst after redoing an edit on the same node', () => {
  open()
  canvas().updateNodePrompt('paid', 'first')
  canvas().undo()
  canvas().redo()
  canvas().updateNodePrompt('paid', 'second')
  canvas().undo()
  expect(node('paid')?.prompt).toBe('first')
  canvas().undo()
  expect(node('paid')?.prompt).toBe('original')
})
