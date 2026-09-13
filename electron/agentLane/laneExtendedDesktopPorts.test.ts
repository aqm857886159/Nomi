import { describe, expect, it, vi } from 'vitest'
import { createLaneExtendedDesktopPorts, type LaneExtendedDesktopPortsInput } from './laneExtendedDesktopPorts'
import type { PreparedTimelineWrite } from '../capabilityCore/timelineTransportAdapters'
import type { PreparedCanvasWrite } from '../capabilityCore/canvasWriteTransportAdapters'
import type { PreparedExportWrite } from '../capabilityCore/phase4SurfaceTransportAdapters'
import type { PreparedSkillWrite } from '../capabilityCore/skillWriteTransportAdapters'
import type { RuntimeToolCall } from '../shared/agentCapabilities/transportContracts'
import type { ProjectAgentProposalReceiptView } from '../shared/projectAgentProposalReceipt'

const binding = { projectId: 'project-1', immutableProjectUuid: '00000000-0000-4000-8000-000000000001', projectGeneration: 1 }
const signal = new AbortController().signal
const plan = { revision: 'revision-1', summary: 'Move clip', operations: [{ kind: 'move', clipId: 'clip-1', startFrame: 0 }] }
const call = (toolName: string, args: unknown = plan): RuntimeToolCall => ({ toolName, args, toolCallId: 'call-1' })

function setup() {
  const records: Array<Record<string, string | number>> = []
  const order: string[] = []
  let receipt: ProjectAgentProposalReceiptView | null = null
  const prepared = (value: RuntimeToolCall) => ({ call: value, invocation: { actionHash: 'action-hash' } })
  const input: LaneExtendedDesktopPortsInput = {
    binding,
    timelineRead: { tryExecute: vi.fn(async () => ({ ok: true as const, result: { operation: 'propose_edit_plan' } })), dispose: vi.fn() },
    timelineWrite: { prepare: vi.fn(async value => prepared(value) as unknown as PreparedTimelineWrite),
      execute: vi.fn(async () => { order.push('execute'); return { ok: true as const, result: { applied: true } } }), dispose: vi.fn() },
    canvasWrite: { prepare: vi.fn(async value => prepared(value) as unknown as PreparedCanvasWrite),
      execute: vi.fn(async () => ({ ok: true as const, result: { applied: true } })), dispose: vi.fn() },
    phase4: { tryExecuteRead: vi.fn(async () => ({ ok: true as const, result: { operation: 'get_media' } })),
      prepareWrite: vi.fn(async value => prepared(value) as unknown as PreparedExportWrite),
      executeWrite: vi.fn(async () => ({ ok: true as const, result: { accepted: true } })), dispose: vi.fn() },
    skillRead: { tryExecute: vi.fn(async () => ({ ok: true as const, result: {} })), dispose: vi.fn() },
    skillWrite: { prepare: vi.fn(async value => prepared(value) as unknown as PreparedSkillWrite), execute: vi.fn(async () => ({ ok: true as const, result: {} })), dispose: vi.fn() },
    generation: vi.fn(() => undefined), receipts: { read: vi.fn(() => receipt) }, onTaskCreated: vi.fn(async () => undefined),
  }
  const assembly = createLaneExtendedDesktopPorts(input)
  const record = vi.fn(async (_type: string, data: Record<string, string | number>) => { order.push('record'); records.push(data) })
  const execute = (value: RuntimeToolCall, abortSignal = signal) => assembly.tools.find(tool => tool.name === value.toolName)!.execute(value.args, { toolCallId: value.toolCallId, signal: abortSignal })
  const prepareAndApprove = async (value: RuntimeToolCall) => { await assembly.toolLifecycle.prepare(value, signal); await assembly.toolLifecycle.approved(value, record) }
  return { input, assembly, record, records, order, execute, prepareAndApprove,
    setReceipt(value: ProjectAgentProposalReceiptView) { receipt = value } }
}

describe('deferred desktop domain authority', () => {
  it('never executes an unprepared or unapproved timeline write', async () => {
    const f = setup(), value = call('edit_timeline')
    expect(await f.execute(value)).toMatchObject({ ok: false, failure: { code: 'capability_authority_invalid' } })
    await f.assembly.toolLifecycle.prepare(value, signal)
    expect(await f.execute(value)).toMatchObject({ ok: false })
    expect(f.input.timelineWrite.execute).not.toHaveBeenCalled()
  })
  it('persists the prepared hash before execution and consumes authority once', async () => {
    const f = setup(), value = call('edit_timeline')
    await f.prepareAndApprove(value)
    expect(await f.execute(value)).toMatchObject({ ok: true })
    expect(f.order).toEqual(['record', 'execute'])
    expect(f.records[0]).toMatchObject({ actionHash: 'action-hash', toolCallId: value.toolCallId })
    expect(await f.execute(value)).toMatchObject({ ok: false })
    expect(f.input.timelineWrite.execute).toHaveBeenCalledTimes(1)
  })
  it('does not execute when authority persistence fails', async () => {
    const f = setup(), value = call('edit_timeline')
    await f.assembly.toolLifecycle.prepare(value, signal)
    await expect(f.assembly.toolLifecycle.approved(value, async () => { throw new Error('disk unavailable') })).rejects.toThrow('disk unavailable')
    expect(await f.execute(value)).toMatchObject({ ok: false })
    expect(f.input.timelineWrite.execute).not.toHaveBeenCalled()
  })
  it('rejects changed parameters under an approved tool call identity', async () => {
    const f = setup(), value = call('edit_timeline')
    await f.prepareAndApprove(value)
    expect(await f.execute({ ...value, args: { ...plan, baseRevision: 'other' } })).toMatchObject({ ok: false })
    expect(f.input.timelineWrite.execute).not.toHaveBeenCalled()
  })
  it.each(['export_video', 'delete_from_canvas'])('requires the correlated committed G5 receipt for %s', async name => {
    const f = setup(), value = call(name, name === 'export_video' ? { expectedRevision: 'revision-1' } : { nodeIds: ['node-1'] })
    await f.prepareAndApprove(value)
    expect(await f.execute(value)).toMatchObject({ ok: false, failure: { code: 'capability_receipt_unresolved' } })
  })
  it('accepts export only when its exact approved receipt is committed', async () => {
    const f = setup(), value = call('export_video', { expectedRevision: 'revision-1' })
    await f.prepareAndApprove(value)
    const authority = f.records[0]
    f.setReceipt({ binding, revision: 1, lifecycle: 'committed', proposalId: String(authority.receiptProposalId), operationId: 'export-commit',
      proposal: { proposalId: String(authority.receiptProposalId), hostApprovalId: String(authority.approvalId), hostActionHash: String(authority.actionHash), summary: 'Export', stepLabels: [], compensation: [], watchNodes: [], reconciliationOk: true } })
    expect(await f.execute(value)).toMatchObject({ ok: true })
  })
  it('does not lose a delayed generation owner, and never falls back to another runtime', async () => {
    const f = setup(), value = call('draft_shots', { shots: [{ prompt: 'test shot' }] })
    await f.assembly.toolLifecycle.prepare(value, signal)
    await f.assembly.toolLifecycle.approved(value, f.record)
    expect(await f.execute(value)).toMatchObject({ ok: false })
    const adapter = { tryExecute: vi.fn(async () => ({ ok: true as const, result: { operationId: 'run-1' } })), dispose: vi.fn() }
    vi.mocked(f.input.generation).mockReturnValue(adapter)
    await f.assembly.toolLifecycle.prepare(value, signal)
    await f.assembly.toolLifecycle.approved(value, f.record)
    expect(await f.execute(value)).toMatchObject({ ok: true })
    expect(adapter.tryExecute).toHaveBeenCalledTimes(1)
  })
  it('settlement cancels an authority whose journal write is still in flight', async () => {
    const f = setup(), value = call('edit_timeline')
    await f.assembly.toolLifecycle.prepare(value, signal)
    let release!: () => void
    const persisted = new Promise<void>(resolve => { release = resolve })
    const approval = f.assembly.toolLifecycle.approved(value, () => persisted)
    f.assembly.toolLifecycle.settled(value)
    release()
    await expect(approval).rejects.toThrow('capability_cancelled')
    expect(await f.execute(value)).toMatchObject({ ok: false })
    expect(f.input.timelineWrite.execute).not.toHaveBeenCalled()
  })
  it('joins a successfully created draft to the domain task projection', async () => {
    const f = setup(), value = call('draft_shots', { shots: [{ prompt: 'Create a short film' }] })
    vi.mocked(f.input.generation).mockReturnValue({ tryExecute: vi.fn(async () => ({ ok: true as const, result: { runId: 'run-1' } })), dispose: vi.fn() })
    await f.prepareAndApprove(value)
    expect(await f.execute(value)).toMatchObject({ ok: true })
    expect(f.input.onTaskCreated).toHaveBeenCalledWith(value, { runId: 'run-1' })
  })
})
