// S5-a 安全网:随机操作序列下 replay(events) ≡ store snapshot(总方案 §1.2 不变量)。
// 这是 S5-b 翻正(日志当唯一真相源)的前置数学证明——影子期它在 CI 锁死
// "store 直接变更"与"事件重放"两条路永远算出同一个画布。
// 覆盖随接线扩展:目前 4 个已接 action(addNode/moveNode/updateNodePrompt/deleteNode)。
import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'
import { setCanvasEventSinkForTests, type CanvasShadowEvent } from './canvasEventEmitter'
import { applyCanvasEvent, replayCanvasEvents } from './canvasEventReducer'

import { normalizePayload } from '../../project/projectNormalize'
import { createDefaultWorkbenchProjectPayload } from '../../project/projectRecordSchema'
import { assertWorkbenchProjectMediaUrlsPersistable } from '../../project/projectMediaMigration'

type Op =
  | { kind: 'add'; title: string; prompt: string; nodeKind: 'image' | 'video' | 'text' }
  | { kind: 'move'; pick: number; x: number; y: number }
  | { kind: 'prompt'; pick: number; text: string }
  | { kind: 'remove'; pick: number }
  | { kind: 'patch'; pick: number; title: string }
  | { kind: 'reassign'; pick: number; categoryId: string }
  | { kind: 'duplicate'; pick: number }
  | { kind: 'copyCat'; pick: number; categoryId: string }
  | { kind: 'selectSome'; pick: number; pick2: number }
  | { kind: 'moveSel'; dx: number; dy: number }
  | { kind: 'delSel' }
  | { kind: 'connect'; pickA: number; pickB: number; mode: 'reference' | 'first_frame' | 'style_ref' }
  | { kind: 'connectPending'; pickA: number; pickB: number }
  | { kind: 'edgeMode'; pickEdge: number; mode: 'reference' | 'last_frame' | 'character_ref' }
  | { kind: 'disconnect'; pickEdge: number }
  | { kind: 'groupCreate'; name: string }
  | { kind: 'groupSelected'; name: string }
  | { kind: 'rename'; pickGroup: number; name: string }
  | { kind: 'setColor'; pickGroup: number; color: string }
  | { kind: 'ungroup'; pickGroup: number }
  | { kind: 'deleteGroup'; pickGroup: number; withNodes: boolean }
  | { kind: 'moveToGroup'; pick: number; pickGroup: number }
  | { kind: 'removeFromGroup'; pick: number }
  | { kind: 'reorder'; pickGroup: number; pickGroup2: number }
  | { kind: 'moveGroupNodes'; pickGroup: number; dx: number; dy: number }
  | { kind: 'status'; pick: number; status: 'queued' | 'running' | 'success' | 'error' | 'idle' }
  | { kind: 'appendRun'; pick: number }
  | { kind: 'addResult'; pick: number; url: string }
  | { kind: 'lock'; pick: number; locked: boolean }
  | { kind: 'cut' }
  | { kind: 'paste' }
  | { kind: 'undo' }
  | { kind: 'redo' }

const CATEGORIES = ['shots', 'characters', 'scenes'] as const
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant<'add'>('add'),
    title: fc.string({ maxLength: 24 }),
    prompt: fc.string({ maxLength: 120 }),
    nodeKind: fc.constantFrom<'image' | 'video' | 'text'>('image', 'video', 'text'),
  }),
  fc.record({ kind: fc.constant<'move'>('move'), pick: fc.nat(99), x: fc.integer({ min: -2000, max: 4000 }), y: fc.integer({ min: -2000, max: 4000 }) }),
  fc.record({ kind: fc.constant<'prompt'>('prompt'), pick: fc.nat(99), text: fc.string({ maxLength: 120 }) }),
  fc.record({ kind: fc.constant<'remove'>('remove'), pick: fc.nat(99) }),
  fc.record({ kind: fc.constant<'patch'>('patch'), pick: fc.nat(99), title: fc.string({ maxLength: 24 }) }),
  fc.record({ kind: fc.constant<'reassign'>('reassign'), pick: fc.nat(99), categoryId: fc.constantFrom(...CATEGORIES) }),
  fc.record({ kind: fc.constant<'duplicate'>('duplicate'), pick: fc.nat(99) }),
  fc.record({ kind: fc.constant<'copyCat'>('copyCat'), pick: fc.nat(99), categoryId: fc.constantFrom(...CATEGORIES) }),
  fc.record({ kind: fc.constant<'selectSome'>('selectSome'), pick: fc.nat(99), pick2: fc.nat(99) }),
  fc.record({ kind: fc.constant<'moveSel'>('moveSel'), dx: fc.integer({ min: -300, max: 300 }), dy: fc.integer({ min: -300, max: 300 }) }),
  fc.record({ kind: fc.constant<'delSel'>('delSel') }),
  fc.record({ kind: fc.constant<'connect'>('connect'), pickA: fc.nat(99), pickB: fc.nat(99), mode: fc.constantFrom<'reference' | 'first_frame' | 'style_ref'>('reference', 'first_frame', 'style_ref') }),
  fc.record({ kind: fc.constant<'connectPending'>('connectPending'), pickA: fc.nat(99), pickB: fc.nat(99) }),
  fc.record({ kind: fc.constant<'edgeMode'>('edgeMode'), pickEdge: fc.nat(99), mode: fc.constantFrom<'reference' | 'last_frame' | 'character_ref'>('reference', 'last_frame', 'character_ref') }),
  fc.record({ kind: fc.constant<'disconnect'>('disconnect'), pickEdge: fc.nat(99) }),
  fc.record({ kind: fc.constant<'groupCreate'>('groupCreate'), name: fc.string({ maxLength: 12 }) }),
  fc.record({ kind: fc.constant<'groupSelected'>('groupSelected'), name: fc.string({ maxLength: 12 }) }),
  fc.record({ kind: fc.constant<'rename'>('rename'), pickGroup: fc.nat(99), name: fc.string({ minLength: 1, maxLength: 12 }) }),
  fc.record({ kind: fc.constant<'setColor'>('setColor'), pickGroup: fc.nat(99), color: fc.constantFrom('red', 'blue', 'green') }),
  fc.record({ kind: fc.constant<'ungroup'>('ungroup'), pickGroup: fc.nat(99) }),
  fc.record({ kind: fc.constant<'deleteGroup'>('deleteGroup'), pickGroup: fc.nat(99), withNodes: fc.boolean() }),
  fc.record({ kind: fc.constant<'moveToGroup'>('moveToGroup'), pick: fc.nat(99), pickGroup: fc.nat(99) }),
  fc.record({ kind: fc.constant<'removeFromGroup'>('removeFromGroup'), pick: fc.nat(99) }),
  fc.record({ kind: fc.constant<'reorder'>('reorder'), pickGroup: fc.nat(99), pickGroup2: fc.nat(99) }),
  fc.record({ kind: fc.constant<'moveGroupNodes'>('moveGroupNodes'), pickGroup: fc.nat(99), dx: fc.integer({ min: -300, max: 300 }), dy: fc.integer({ min: -300, max: 300 }) }),
  fc.record({ kind: fc.constant<'status'>('status'), pick: fc.nat(99), status: fc.constantFrom<'queued' | 'running' | 'success' | 'error' | 'idle'>('queued', 'running', 'success', 'error', 'idle') }),
  fc.record({ kind: fc.constant<'appendRun'>('appendRun'), pick: fc.nat(99) }),
  fc.record({ kind: fc.constant<'addResult'>('addResult'), pick: fc.nat(99), url: fc.constantFrom('https://cdn/a.png', 'https://cdn/b.mp4') }),
  fc.record({ kind: fc.constant<'lock'>('lock'), pick: fc.nat(99), locked: fc.boolean() }),
  fc.record({ kind: fc.constant<'cut'>('cut') }),
  fc.record({ kind: fc.constant<'paste'>('paste') }),
  fc.record({ kind: fc.constant<'undo'>('undo') }),
  fc.record({ kind: fc.constant<'redo'>('redo') }),
)

function applyOp(op: Op): void {
  const store = useGenerationCanvasStore.getState()
  const nodes = store.nodes
  const edges = store.edges
  const groups = store.groups
  const pickNode = (index: number) => (nodes.length ? nodes[index % nodes.length] : undefined)
  const pickGroup = (index: number) => (groups.length ? groups[index % groups.length] : undefined)
  switch (op.kind) {
    case 'add':
      store.addNode({ kind: op.nodeKind, title: op.title || 'n', prompt: op.prompt })
      return
    case 'move': {
      const target = pickNode(op.pick)
      if (target) store.moveNode(target.id, { x: op.x, y: op.y })
      return
    }
    case 'prompt': {
      const target = pickNode(op.pick)
      if (target) store.updateNodePrompt(target.id, op.text)
      return
    }
    case 'remove': {
      const target = pickNode(op.pick)
      if (target) store.deleteNode(target.id)
      return
    }
    case 'lock': {
      const target = pickNode(op.pick)
      if (target) store.setNodeLocked(target.id, op.locked)
      return
    }
    case 'patch': {
      const target = pickNode(op.pick)
      if (target) store.updateNode(target.id, { title: op.title })
      return
    }
    case 'reassign': {
      const target = pickNode(op.pick)
      if (target) store.reassignNodeCategory(target.id, op.categoryId)
      return
    }
    case 'duplicate': {
      const target = pickNode(op.pick)
      if (target) store.duplicateNodeForRegeneration(target.id)
      return
    }
    case 'copyCat': {
      const target = pickNode(op.pick)
      if (target) store.copyNodeToCategory(target.id, op.categoryId)
      return
    }
    case 'selectSome': {
      const a = pickNode(op.pick)
      const b = pickNode(op.pick2)
      if (a) store.selectNode(a.id)
      if (b && b.id !== a?.id) store.selectNode(b.id, true)
      return
    }
    case 'moveSel':
      store.moveSelectedNodes({ x: op.dx, y: op.dy })
      return
    case 'delSel':
      store.deleteSelectedNodes()
      return
    case 'connect': {
      const a = pickNode(op.pickA)
      const b = pickNode(op.pickB)
      if (a && b && a.id !== b.id) store.connectNodes(a.id, b.id, op.mode)
      return
    }
    case 'connectPending': {
      const a = pickNode(op.pickA)
      const b = pickNode(op.pickB)
      if (a && b && a.id !== b.id) {
        store.startConnection(a.id)
        store.connectToNode(b.id)
      }
      return
    }
    case 'edgeMode': {
      const edge = edges.length ? edges[op.pickEdge % edges.length] : undefined
      if (edge) store.updateEdgeMode(edge.id, op.mode)
      return
    }
    case 'disconnect': {
      const edge = edges.length ? edges[op.pickEdge % edges.length] : undefined
      if (edge) store.disconnectEdge(edge.id)
      return
    }
    case 'groupCreate':
      store.createGroup('shots', op.name)
      return
    case 'groupSelected':
      store.groupSelectedNodes('shots', op.name)
      return
    case 'rename': {
      const group = pickGroup(op.pickGroup)
      if (group) store.renameGroup(group.id, op.name)
      return
    }
    case 'setColor': {
      const group = pickGroup(op.pickGroup)
      if (group) store.setGroupColor(group.id, op.color)
      return
    }
    case 'ungroup': {
      const group = pickGroup(op.pickGroup)
      if (group) store.ungroup(group.id)
      return
    }
    case 'deleteGroup': {
      const group = pickGroup(op.pickGroup)
      if (group) store.deleteGroup(group.id, op.withNodes)
      return
    }
    case 'moveToGroup': {
      const target = pickNode(op.pick)
      const group = pickGroup(op.pickGroup)
      if (target && group) store.moveNodeToGroup(target.id, group.id)
      return
    }
    case 'removeFromGroup': {
      const target = pickNode(op.pick)
      if (target) store.removeNodeFromGroup(target.id)
      return
    }
    case 'reorder': {
      const a = pickGroup(op.pickGroup)
      const b = pickGroup(op.pickGroup2)
      if (a && b && a.id !== b.id) store.reorderGroup('shots', a.id, b.id)
      return
    }
    case 'moveGroupNodes': {
      const group = pickGroup(op.pickGroup)
      if (group) store.moveGroupNodes(group.id, { x: op.dx, y: op.dy })
      return
    }
    case 'status': {
      const target = pickNode(op.pick)
      if (target) store.setNodeStatus(target.id, op.status, op.status === 'error' ? 'boom' : undefined)
      return
    }
    case 'appendRun': {
      const target = pickNode(op.pick)
      if (target) store.appendNodeRun(target.id, { status: 'queued', startedAt: 1000, updatedAt: 1000 })
      return
    }
    case 'addResult': {
      const target = pickNode(op.pick)
      if (target) store.addNodeResult(target.id, { id: `r-${target.id}-${op.url.length}`, url: op.url, createdAt: 2000 } as never)
      return
    }
    case 'cut':
      store.cutSelectedNodes()
      return
    case 'paste':
      store.pasteNodes()
      return
    case 'undo':
      store.undo()
      return
    case 'redo':
      store.redo()
      return
  }
}

describe('S5-a replay ≡ snapshot(属性测试,CI 安全网)', () => {
  let captured: CanvasShadowEvent[] = []

  beforeEach(() => {
    captured = []
    setCanvasEventSinkForTests((events) => captured.push(...events))
  })
  afterEach(() => {
    setCanvasEventSinkForTests(null)
  })

  it('任意操作序列下,事件重放与 store 投影逐字节一致', () => {
    fc.assert(
      fc.property(fc.array(opArbitrary, { maxLength: 40 }), (ops) => {
        captured = []
        __resetGenerationCanvasHistoryForTests()
        useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
        for (const op of ops) applyOp(op)
        const state = useGenerationCanvasStore.getState()
        const projection = { nodes: state.nodes, edges: state.edges, groups: state.groups }
        const payload = normalizePayload({ ...createDefaultWorkbenchProjectPayload(), generationCanvas: state.readDocumentSnapshot() })
        assertWorkbenchProjectMediaUrlsPersistable({ id: 'replay', name: 'Replay', createdAt: 1, updatedAt: 1, version: 1, payload })
        const replayed = replayCanvasEvents(captured)
        expect(JSON.parse(JSON.stringify(replayed))).toEqual(JSON.parse(JSON.stringify(projection)))
      }),
      { numRuns: 60 },
    )
  })

  it('applyEventTail 幂等:同一条尾巴重放两遍结果不变(S5-b-1 崩溃恢复的安全前提)', () => {
    __resetGenerationCanvasHistoryForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    captured = []
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'n', prompt: 'p' })
    useGenerationCanvasStore.getState().moveNode(node.id, { x: 7, y: 9 })
    useGenerationCanvasStore.getState().createGroup('shots', 'g')
    const tail = captured.map((event) => ({ type: event.type, payload: event.payload }))
    // 模拟崩溃恢复:回到空快照,重放尾巴一遍 vs 两遍
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    useGenerationCanvasStore.getState().applyEventTail(tail)
    const once = JSON.parse(JSON.stringify({ n: useGenerationCanvasStore.getState().nodes, g: useGenerationCanvasStore.getState().groups }))
    useGenerationCanvasStore.getState().applyEventTail(tail)
    const twice = JSON.parse(JSON.stringify({ n: useGenerationCanvasStore.getState().nodes, g: useGenerationCanvasStore.getState().groups }))
    expect(twice).toEqual(once)
    expect(once.n).toHaveLength(1)
    expect(once.g).toHaveLength(1)
  })

  it('旧 connected 尾巴沿用旧 edge id，后续改标签与断开仍能命中', () => {
    const connected = applyCanvasEvent(
      { nodes: [], edges: [], groups: [] },
      { type: 'canvas.edge.connected', payload: { sourceNodeId: 'source', targetNodeId: 'target', mode: 'reference' } },
    )
    expect(connected.edges).toHaveLength(1)
    expect(connected.edges[0]?.id).toBe('edge-source-target')

    const relabeled = applyCanvasEvent(connected, {
      type: 'canvas.edge.mode-changed',
      payload: { edgeId: 'edge-source-target', mode: 'style_ref' },
    })
    expect(relabeled.edges[0]?.mode).toBe('style_ref')

    const disconnected = applyCanvasEvent(relabeled, {
      type: 'canvas.edge.disconnected',
      payload: { edgeId: 'edge-source-target' },
    })
    expect(disconnected.edges).toEqual([])
  })

  it('旧快照重复重放 connected 尾巴时按 legacy edge id 幂等，不生成双参考', () => {
    const snapshot = {
      nodes: [],
      groups: [],
      edges: [{ id: 'edge-source-target', source: 'source', target: 'target', mode: 'style_ref' as const, order: 0 }],
    }
    const repeatedConnect = applyCanvasEvent(snapshot, {
      type: 'canvas.edge.connected',
      payload: { sourceNodeId: 'source', targetNodeId: 'target', mode: 'reference' },
    })
    const relabeled = applyCanvasEvent(repeatedConnect, {
      type: 'canvas.edge.mode-changed',
      payload: { edgeId: 'edge-source-target', mode: 'style_ref' },
    })

    expect(relabeled.edges).toEqual(snapshot.edges)
  })

  it('新快照重复重放 full-edge added 尾巴时按 edge id 幂等', () => {
    const snapshot = {
      nodes: [],
      groups: [],
      edges: [{ id: 'edge-source::target::0', source: 'source', target: 'target', mode: 'style_ref' as const, order: 0 }],
    }
    const repeatedAdd = applyCanvasEvent(snapshot, {
      type: 'canvas.edge.added',
      payload: {
        edge: { id: 'edge-source::target::0', source: 'source', target: 'target', mode: 'reference', order: 0 },
      },
    })
    const relabeled = applyCanvasEvent(repeatedAdd, {
      type: 'canvas.edge.mode-changed',
      payload: { edgeId: 'edge-source::target::0', mode: 'style_ref' },
    })

    expect(relabeled.edges).toEqual(snapshot.edges)
  })

  it('重复 removed 尾巴按 edge id 删除已改过标签的边', () => {
    const snapshot = {
      nodes: [],
      groups: [],
      edges: [{ id: 'edge-source::target::0', source: 'source', target: 'target', mode: 'style_ref' as const, order: 0 }],
    }
    const removed = applyCanvasEvent(snapshot, {
      type: 'canvas.edge.removed',
      payload: {
        edge: { id: 'edge-source::target::0', source: 'source', target: 'target', mode: 'reference', order: 0 },
      },
    })

    expect(removed.edges).toEqual([])
    expect(applyCanvasEvent(removed, {
      type: 'canvas.edge.removed',
      payload: {
        edge: { id: 'edge-source::target::0', source: 'source', target: 'target', mode: 'reference', order: 0 },
      },
    })).toEqual(removed)
  })

  it('新连接事件携带完整边对象和真实 edge id', () => {
    __resetGenerationCanvasHistoryForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    const source = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'source', prompt: '' })
    const target = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'target', prompt: '' })
    captured = []

    useGenerationCanvasStore.getState().connectNodes(source.id, target.id, 'reference')

    const edge = useGenerationCanvasStore.getState().edges[0]
    expect(edge).toBeDefined()
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ type: 'canvas.edge.added', payload: { edge } })
  })

  it('setNodeProgress(轮询 tick)不发事件——瞬态不入日志(§4.3 终态收敛)', () => {
    __resetGenerationCanvasHistoryForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', title: 'n', prompt: 'p' })
    captured = []
    useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'generating', message: '生成中' })
    useGenerationCanvasStore.getState().setNodeProgress(node.id, { phase: 'generating', message: '还在生成' })
    expect(captured).toEqual([])
  })
})
