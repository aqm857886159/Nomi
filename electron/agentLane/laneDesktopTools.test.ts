import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { LaneHandle } from '../shared/agentLane/laneContracts'
import type { CanvasWritePort, DocumentWritePort } from '../capabilityCore/capabilityExecutorRegistry'
import type { DesktopCanvasReadRuntime } from '../capabilityCore/canvasReadMainRuntime'
import type { CanvasWriteRawEvidence } from '../shared/agentCapabilities/canvasWriteEvidence'
import { createMainCapabilityExecutorRegistry } from '../capabilityCore/capabilityExecutorRegistry'
import { createCanvasReadSurfaceRegistry, createSurfaceOwnerAuthority } from '../capabilityCore/canvasReadSurfaceRegistry'
import { createProjectAgentProposalReceiptService } from '../capabilityCore/projectAgentProposalReceiptStore'
import { createDesktopLaneTools } from './laneDesktopTools'
import { executeLaneReceiptCommand } from './laneReceiptCommands'
import { LANE_RECEIPT_AUTHORITY_NOTE } from '../shared/agentLane/laneReceiptAuthority'
import { openLane } from './laneHost.mjs'
import { createHttpFixture } from '../../tests/agent-runtime/httpFixture.mjs'

// Replace only the GUI's global registry with an actual temporary Surface registry.
// Verified invocation factories, capability executor, lane, approvals and G5 service stay real.
const desktopRuntime = vi.hoisted(() => ({ registry: undefined as unknown }))
vi.mock('../capabilityCore/canvasReadSurfaceRuntime', () => ({ canvasReadSurfaceRuntime: desktopRuntime }))
vi.mock('../productionRun/productionRunRuntime', () => ({ getProductionRunService: () => ({}) }))

const binding = { projectId: 'desktop-fixture', immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1 }
const documentTarget = { kind: 'document' as const, documentId: 'document-fixture', anchor: { kind: 'whole-document' as const } }
const documentPreconditions = { document: { revision: 1, contentHash: 'fnv1a-before' } }
const rawEvidence: CanvasWriteRawEvidence = {
  node: { id: 'node-fixture', kind: 'image', title: 'Fixture shot', prompt: 'Original fixture prompt', locked: false,
    categoryId: 'shots', groupId: null,
    model: { modelKey: 'fixture-model', vendorKey: 'fixture-vendor', archetypeId: null, modeId: null, variantId: null }, currentResult: null },
  groups: [],
}
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture(kind: 'document' | 'canvas' | 'delete', receiptMode: 'committed' | 'missing' | 'mismatch' = 'committed') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-desktop-lane-receipts-'))
  cleanups.push(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, '.nomi'))
  const documentFile = path.join(root, 'fixture-document.txt')
  const canvasFile = path.join(root, 'fixture-canvas.json')
  await fs.writeFile(documentFile, 'Original fixture document.')
  const deleteEvidence = { nodes: ['delete-one', 'delete-two'].map(id => ({ ...rawEvidence.node, id, position: { x: 0, y: 0 } })),
    edges: [], groups: [], resolvedReferences: [{ requestedId: 'delete-one', nodeId: 'delete-one' }] }
  await fs.writeFile(canvasFile, JSON.stringify(kind === 'delete' ? deleteEvidence : rawEvidence))
  const receipts = createProjectAgentProposalReceiptService({ projectRoot: root, binding })
  const ownerAuthority = createSurfaceOwnerAuthority()
  const owner = ownerAuthority.capture({ contents: {}, frame: {}, webContentsId: 1, processId: 2, frameRoutingId: 3,
    origin: 'file://', isLive: () => true })
  const registry = createCanvasReadSurfaceRegistry({ ownerAuthority, resolveProjectIdentity: async () => ({ ...binding,
    canonicalRootPath: root, canonicalRootDigest: 'fixture-root-digest' }) })
  const suspended = registry.suspend(owner, { surfaceInstanceId: 'fixture-surface' })
  const committed = await registry.commitCanvasRead(owner, { projectId: binding.projectId, suspension: suspended })
  const capturedPort = registry.captureCanvasReadPort(owner, committed)
  desktopRuntime.registry = registry
  const order: string[] = []
  let sawQueuedAuthority = false
  const documentPort: DocumentWritePort = { write: async (input) => {
    order.push('document-write')
    expect(receipts.read()).toMatchObject({ lifecycle: 'preparing' })
    expect(input.target).toEqual(documentTarget)
    expect(input.preconditions).toEqual(documentPreconditions)
    const previous = await fs.readFile(documentFile, 'utf8')
    await fs.writeFile(documentFile, input.operation === 'append' ? previous + input.content : input.content)
    return { applied: true, revision: 2, contentHash: 'fnv1a-after' }
  } }
  const canvasPort: CanvasWritePort = {
    capture: async (input) => {
      order.push('canvas-capture')
      const evidence = JSON.parse(await fs.readFile(canvasFile, 'utf8'))
      if (kind === 'delete') evidence.resolvedReferences = (input.input as { nodeIds: string[] }).nodeIds
        .map(id => ({ requestedId: id, nodeId: id }))
      return evidence
    },
    write: async (input) => {
      order.push('canvas-write')
      const authority = lane.receiptAuthority(input.receiptProposalId)
      expect(authority).toEqual({ receiptProposalId: input.receiptProposalId, approvalId: input.approvalId, actionHash: input.actionHash })
      sawQueuedAuthority = !lane.projection().parts.some((part) => part.kind === 'host-note' && part.noteType === LANE_RECEIPT_AUTHORITY_NOTE)
      expect(sawQueuedAuthority).toBe(true)
      const proposal = { proposalId: input.receiptProposalId, hostApprovalId: receiptMode === 'mismatch' ? 'wrong-approval' : input.approvalId,
        hostActionHash: input.actionHash, summary: 'Update fixture prompt', stepLabels: ['Update fixture prompt'],
        compensation: [], watchNodes: [], reconciliationOk: true }
      const writeReceipt = (lifecycle: 'preparing' | 'committed') => executeLaneReceiptCommand(receipts, lane, {
        kind: 'receipt-write', workspaceId: 'fixture-workspace', input: {
          expectedRevision: receipts.read()?.revision ?? 0, proposalId: proposal.proposalId,
          operationId: `canvas-${lifecycle}`, lifecycle, proposal,
        },
      })
      if (receiptMode !== 'missing') { writeReceipt('preparing'); order.push('canvas-preparing') }
      const deletedNodeIds = kind === 'delete' ? (input.input as { nodeIds: string[] }).nodeIds : []
      if (kind === 'delete') expect(input.input).toMatchObject({ operation: 'delete_canvas_nodes', reason: 'Unused fixture shot' })
      const previous = JSON.parse(await fs.readFile(canvasFile, 'utf8')) as typeof deleteEvidence
      const next = kind === 'delete'
        ? { ...previous, nodes: previous.nodes.filter(node => !deletedNodeIds.includes(node.id)) }
        : { ...rawEvidence, node: { ...rawEvidence.node, prompt: (input.input as { prompt: string }).prompt } }
      await fs.writeFile(canvasFile, JSON.stringify(next))
      if (receiptMode !== 'missing') { writeReceipt('committed'); order.push('canvas-committed') }
      if (kind === 'delete') return { applied: true, proposalId: input.receiptProposalId,
        operation: 'delete_canvas_nodes', deletedNodeIds, reconciliation: { ok: true, deviationCount: 0 } }
      return { applied: true, proposalId: input.receiptProposalId, operation: 'set_node_prompt', affectedNodeIds: ['node-fixture'],
        reconciliation: { ok: true, deviationCount: 0 } }
    },
  }
  const executor = createMainCapabilityExecutorRegistry({ resolveCanvasReadPort: async () => ({ read: async () => ({}) }),
    resolveDocumentWritePort: async () => documentPort, resolveCanvasWritePort: async () => canvasPort })
  const surface = { executor, surfaceCapture: { captureCommittedCanvasReadPort: () => capturedPort },
    surfacePortRuntime: { createCanvasWritePort: () => canvasPort } } as unknown as DesktopCanvasReadRuntime
  const policy = { mode: kind === 'delete' ? 'safe-auto' as const : 'step' as const, spend: 'confirm' as const }
  const assembly = createDesktopLaneTools({ event: {} as IpcMainInvokeEvent, binding, surface, receipts,
    context: () => ({ approvalPolicy: policy, documentId: 'document-fixture',
      target: documentTarget, preconditions: documentPreconditions }),
    // 同一份快照的另一半：付费那一侧问的是「这笔钱要不要停下来问」。
    approvalPolicy: () => policy,
    generationFactory: () => undefined, onTaskCreated: async () => undefined })
  cleanups.push(async () => assembly.dispose())
  const toolName = kind === 'document' ? 'append_to_end' : kind === 'delete' ? 'delete_canvas_nodes' : 'nomi_canvas_write'
  const args = kind === 'document' ? { content: ' Appended fixture.' }
    : kind === 'delete' ? { nodeIds: ['delete-one'], reason: 'Unused fixture shot' }
    : { operation: 'set_node_prompt', nodeId: 'node-fixture', prompt: 'Updated fixture prompt' }
  const http = await createHttpFixture([{ type: 'tool', calls: [{ id: 'fixture-call', name: toolName, arguments: args }] },
    ...(kind === 'delete' && receiptMode === 'committed' ? [{ type: 'tool' as const,
      calls: [{ id: 'second-delete', name: toolName, arguments: { nodeIds: ['delete-two'], reason: 'Unused fixture shot' } }] }] : []),
    { type: 'text', text: 'Fixture complete.' }])
  cleanups.push(http.close)
  const lane: LaneHandle = await openLane({ fetch: globalThis.fetch, projectDir: root, model: { kind: 'openai-compatible', providerId: 'fixture', modelId: 'fixture',
    baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture' }, systemPrompt: 'Receipt fixture.',
    tools: assembly.tools, toolLifecycle: assembly.toolLifecycle,
    approval: { hasUserInterface: true, policy: () => policy } })
  cleanups.push(() => lane.close())
  const pending = (run: Promise<unknown>) => Promise.race([
    lane.projection().pending ? Promise.resolve() : new Promise<void>((resolve) => {
      const stop = lane.subscribe((projection) => { if (projection.pending) { stop(); resolve() } })
    }),
    run.then(() => { throw new Error(`Fixture finished before approval: ${JSON.stringify(lane.projection().parts)}`) }),
  ])
  return { lane, receipts, order, pending, root, assembly, toolName, args, documentFile, canvasFile,
    sawQueuedAuthority: () => sawQueuedAuthority }
}

describe('desktop lane verified writes and durable receipts', () => {
  it('safe-auto deletion requires a fresh once-only approval, retains reason and count, and commits the actual G5 deletion', async () => {
    const f = await fixture('delete')
    const run = f.lane.execute({ kind: 'prompt', text: 'Remove the unused fixture shots.' })
    await f.pending(run)
    expect(f.lane.projection().pending).toMatchObject({ effectClass: 'irreversible', grantable: false,
      args: { nodeIds: ['delete-one'], reason: 'Unused fixture shot' }, pendingCount: 1 })
    expect(f.receipts.read()).toBeNull()
    expect(JSON.parse(await fs.readFile(f.canvasFile, 'utf8')).nodes).toHaveLength(2)
    await expect(f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-session' })).rejects.toThrow()
    expect(f.lane.projection().pending?.toolCallId).toBe('fixture-call')
    await f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-once' })
    await f.pending(run)
    expect(f.lane.projection().pending).toMatchObject({ toolCallId: 'second-delete', effectClass: 'irreversible', grantable: false })
    expect(JSON.parse(await fs.readFile(f.canvasFile, 'utf8')).nodes.map((node: { id: string }) => node.id)).toEqual(['delete-two'])
    const receipt = f.receipts.read()
    expect(receipt).toMatchObject({ lifecycle: 'committed', revision: 2 })
    expect(createProjectAgentProposalReceiptService({ projectRoot: f.root, binding }).read()).toEqual(receipt)
    await f.lane.execute({ kind: 'approval', toolCallId: 'second-delete', action: 'deny' })
    await run
    expect(f.order.filter(item => item === 'canvas-write')).toHaveLength(1)
    expect(f.sawQueuedAuthority()).toBe(true)
    expect(f.lane.projection().parts.find(part => part.kind === 'tool-result')).toMatchObject({ isError: false })
    const tool = f.assembly.tools.find(candidate => candidate.name === f.toolName)!
    expect(await tool.execute(f.args, { toolCallId: 'fixture-call', signal: new AbortController().signal })).toMatchObject({ ok: false })
  })

  it('cannot report deletion success without the actual matching committed G5 receipt', async () => {
    const f = await fixture('delete', 'missing')
    const run = f.lane.execute({ kind: 'prompt', text: 'Remove the unused fixture shot.' })
    await f.pending(run)
    await f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-once' })
    await run
    expect(f.receipts.read()).toBeNull()
    expect(f.lane.projection().parts.find(part => part.kind === 'tool-result')).toMatchObject({ isError: true,
      text: expect.stringContaining('capability_receipt_unresolved') })
  })

  it('prepares and approves one document write, commits its real G5 receipt and preserves both on reopen', async () => {
    const f = await fixture('document')
    const run = f.lane.execute({ kind: 'prompt', text: 'Append the fixture.' })
    await f.pending(run)
    expect(f.receipts.read()).toBeNull()
    expect(await fs.readFile(f.documentFile, 'utf8')).toBe('Original fixture document.')
    await f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-once' })
    await run
    expect(f.order).toEqual(['document-write'])
    expect(await fs.readFile(f.documentFile, 'utf8')).toBe('Original fixture document. Appended fixture.')
    const receipt = f.receipts.read()
    expect(receipt).toMatchObject({ lifecycle: 'committed', revision: 2, proposal: {
      hostApprovalId: expect.stringMatching(/^approval-/), hostActionHash: expect.any(String) } })
    expect(createProjectAgentProposalReceiptService({ projectRoot: f.root, binding }).read()).toEqual(receipt)
    expect(f.lane.projection().parts.find((part) => part.kind === 'tool-result')).toMatchObject({ isError: false })
    const tool = f.assembly.tools.find((candidate) => candidate.name === f.toolName)!
    expect(await tool.execute(f.args, { toolCallId: 'fixture-call', signal: new AbortController().signal })).toMatchObject({ ok: false })
    expect(await fs.readFile(f.documentFile, 'utf8')).toBe('Original fixture document. Appended fixture.')
  })

  it('resolves queued SDK authority during the actual canvas executor and commits through the renderer receipt command', async () => {
    const f = await fixture('canvas')
    const run = f.lane.execute({ kind: 'prompt', text: 'Update the fixture prompt.' })
    await f.pending(run)
    expect(f.order).toEqual(['canvas-capture'])
    await f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-once' })
    await run
    expect(f.sawQueuedAuthority()).toBe(true)
    expect(f.order).toEqual(['canvas-capture', 'canvas-write', 'canvas-preparing', 'canvas-committed'])
    expect(JSON.parse(await fs.readFile(f.canvasFile, 'utf8')).node.prompt).toBe('Updated fixture prompt')
    expect(f.receipts.read()).toMatchObject({ lifecycle: 'committed', revision: 2 })
    expect(f.lane.projection().parts.find((part) => part.kind === 'tool-result')).toMatchObject({ isError: false })
  })

  it('refuses to report canvas success if the renderer omits its committed G5 receipt', async () => {
    const f = await fixture('canvas', 'missing')
    const run = f.lane.execute({ kind: 'prompt', text: 'Update the fixture prompt.' })
    await f.pending(run)
    await f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-once' })
    await run
    expect(f.receipts.read()).toBeNull()
    expect(f.lane.projection().parts.find((part) => part.kind === 'tool-result')).toMatchObject({ isError: true,
      text: expect.stringContaining('capability_receipt_unresolved') })
  })

  it('rejects a mismatched renderer approval before either the receipt or canvas changes', async () => {
    const f = await fixture('canvas', 'mismatch')
    const run = f.lane.execute({ kind: 'prompt', text: 'Update the fixture prompt.' })
    await f.pending(run)
    await f.lane.execute({ kind: 'approval', toolCallId: 'fixture-call', action: 'allow-once' })
    await run
    expect(f.receipts.read()).toBeNull()
    expect(JSON.parse(await fs.readFile(f.canvasFile, 'utf8')).node.prompt).toBe('Original fixture prompt')
    expect(f.lane.projection().parts.find((part) => part.kind === 'tool-result')).toMatchObject({ isError: true })
  })

  it('cannot execute a prepared document write without approval', async () => {
    const f = await fixture('document')
    const signal = new AbortController().signal
    const call = { toolCallId: 'unapproved-call', toolName: f.toolName, args: f.args }
    await f.assembly.toolLifecycle.prepare(call, signal)
    const tool = f.assembly.tools.find((candidate) => candidate.name === call.toolName)!
    expect(await tool.execute(call.args, { toolCallId: call.toolCallId, signal })).toMatchObject({ ok: false })
    expect(f.receipts.read()).toBeNull()
    expect(await fs.readFile(f.documentFile, 'utf8')).toBe('Original fixture document.')
    expect(f.order).toEqual([])
  })
})
