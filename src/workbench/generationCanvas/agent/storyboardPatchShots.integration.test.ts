import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  assertCanvasWriteAdmissionMatches,
  buildCanvasWriteAdmissionForOperation,
} from '../../../../electron/shared/agentCapabilities/canvasWriteEvidence'
import type { CanvasWriteInput } from '../../../../electron/shared/agentCapabilities/canvasWrite'
import {
  createProjectAgentProposalReceiptService,
  type ProjectAgentProposalReceiptService,
} from '../../../../electron/projectAgentHost/projectAgentProposalReceiptStore'
import { applyProposalBatch } from './proposalTxn'
import type { ProposalReceiptCoordinator } from './proposalUndo'
import { abandonPendingCanvasWrite } from '../events/canvasWriteBoundary'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { readGenerationCanvasSnapshot } from './generationCanvasTools'
import { captureCanvasWriteRawEvidence } from './canvasWriteTarget'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { useWorkbenchStore } from '../../workbenchStore'
import { readCurrentWorkbenchProjectPayload, restoreWorkbenchProjectPayload } from '../../project/workbenchProjectSession'
import type { StoryboardPlan } from './storyboardPlan'

const binding = {
  projectId: 'storyboard-patch-project',
  immutableProjectUuid: '33333333-3333-4333-8333-333333333333',
  projectGeneration: 1,
} as const

const plan: StoryboardPlan = {
  title: '雨夜追凶',
  anchors: [],
  shots: [
    { index: 1, durationSec: 5, anchorIds: [], prompt: '推镜' },
    { index: 2, durationSec: 8, anchorIds: [], prompt: '跟拍', params: { aspect_ratio: '16:9', quality: 'high' } },
    { index: 3, durationSec: 5, anchorIds: [], prompt: '远景' },
  ],
}

let projectRoot = ''

function resetStores(): void {
  abandonPendingCanvasWrite()
  __resetCanvasUndoJournalForTests()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  useWorkbenchStore.getState().hydrateWorkbenchDocuments(
    [{ id: 'storyboard-doc', version: 1, title: '雨夜追凶', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }],
    'storyboard-doc',
  )
  useWorkbenchStore.getState().hydrateStoryboardPlans({ 'storyboard-doc': { plan, committed: false } })
}

function receiptCoordinator(service: ProjectAgentProposalReceiptService, proposalId: string): ProposalReceiptCoordinator {
  const proposal = {
    proposalId,
    hostApprovalId: 'approval-canonical-patch',
    hostActionHash: 'd'.repeat(64),
    summary: '修改第 2 镜：追加雨天并改画幅',
    stepLabels: ['第 2 镜 · prompt + aspectRatio'],
    compensation: [],
    watchNodes: [],
    reconciliationOk: true,
  }
  return {
    async prepare(id) {
      service.write({
        expectedRevision: service.read()?.revision ?? 0,
        proposalId: id,
        operationId: `prepare:${id}`,
        lifecycle: 'preparing',
        proposal,
      })
      return true
    },
    async commit(input) {
      service.write({
        expectedRevision: service.read()?.revision ?? 0,
        proposalId: input.proposalId,
        operationId: `commit:${input.proposalId}`,
        lifecycle: 'committed',
        proposal: {
          ...proposal,
          compensation: input.compensation,
          watchNodes: input.watchNodes,
          reconciliationOk: input.reconciliationOk,
        },
      })
      return true
    },
    async abort(id) {
      const current = service.read()
      if (!current || current.lifecycle !== 'preparing') return
      service.transition({
        expectedRevision: current.revision,
        proposalId: id,
        operationId: `undoing:${id}`,
        lifecycle: 'undoing',
      })
      const undoing = service.read()
      if (undoing) service.transition({
        expectedRevision: undoing.revision,
        proposalId: id,
        operationId: `undone:${id}`,
        lifecycle: 'undone',
      })
    },
    async disposition(id) {
      return service.read()?.proposalId === id ? service.read()!.lifecycle : 'missing'
    },
  }
}

beforeEach(resetStores)

afterEach(() => {
  abandonPendingCanvasWrite()
  if (projectRoot) fs.rmSync(projectRoot, { recursive: true, force: true })
  projectRoot = ''
})

describe('canonical storyboard patch production transaction', () => {
  it('previews admission, approves through nomi_canvas_plan, persists the receipt, and restores the plan after restart', async () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-patch-'))
    fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
    const service = createProjectAgentProposalReceiptService({ projectRoot, binding })
    const input: CanvasWriteInput = {
      operation: 'patch_shots',
      select: { kind: 'indexes', indexes: [2] },
      patch: { promptAppend: '雨天', aspectRatio: '9:16' },
    }
    const rawEvidence = captureCanvasWriteRawEvidence(
      readGenerationCanvasSnapshot(),
      { operation: input.operation, input },
    )
    const admission = buildCanvasWriteAdmissionForOperation(rawEvidence, input)
    expect(admission.target).toEqual({ kind: 'canvas', nodeIds: [] })
    expect(admission.preconditions).toEqual({ edges: [{ relationHash: expect.stringMatching(/^sha256-/) }] })

    const outcome = await applyProposalBatch(
      [{ toolCallId: 'tool-canonical-patch', toolName: 'nomi_canvas_plan', effectiveArgs: input }],
      undefined,
      receiptCoordinator(service, 'receipt-canonical-patch'),
      {
        proposalId: 'receipt-canonical-patch',
        beforePrepare() {
          assertCanvasWriteAdmissionMatches(rawEvidence, admission, input)
        },
      },
    )

    expect(outcome).toMatchObject({ status: 'committed', proposalId: 'receipt-canonical-patch' })
    expect(useWorkbenchStore.getState().storyboardPlans['storyboard-doc']?.plan.shots).toEqual([
      plan.shots[0],
      { ...plan.shots[1], prompt: '跟拍，雨天', params: { aspect_ratio: '9:16', quality: 'high' } },
      plan.shots[2],
    ])
    expect(service.read()).toMatchObject({ lifecycle: 'committed', proposalId: 'receipt-canonical-patch' })
    expect(createProjectAgentProposalReceiptService({ projectRoot, binding }).read()).toEqual(service.read())

    const payload = readCurrentWorkbenchProjectPayload()
    expect(payload.storyboardPlans['storyboard-doc']?.plan.shots[1]).toMatchObject({
      prompt: '跟拍，雨天',
      params: { aspect_ratio: '9:16', quality: 'high' },
    })
    expect(payload.storyboardDesignsByDocumentId?.['storyboard-doc']?.[0]?.plan.shots[1]).toMatchObject({
      prompt: '跟拍，雨天',
      params: { aspect_ratio: '9:16', quality: 'high' },
    })
    useWorkbenchStore.setState({
      workbenchDocuments: [],
      activeDocumentId: null,
      storyboardPlans: {},
      storyboardDesignsByDocumentId: {},
      activeStoryboardId: null,
    })
    restoreWorkbenchProjectPayload(payload)
    expect(useWorkbenchStore.getState().storyboardPlans['storyboard-doc']?.plan.shots[1]).toMatchObject({
      prompt: '跟拍，雨天',
      durationSec: 8,
      params: { aspect_ratio: '9:16', quality: 'high' },
    })
  })

  it('rejects a bad captured revision before receipt preparation or plan mutation', async () => {
    const input: CanvasWriteInput = {
      operation: 'patch_shots',
      select: { kind: 'indexes', indexes: [2] },
      patch: { prompt: '错误 revision 不应落地' },
    }
    const rawEvidence = captureCanvasWriteRawEvidence(
      readGenerationCanvasSnapshot(),
      { operation: input.operation, input },
    )
    const admission = buildCanvasWriteAdmissionForOperation(rawEvidence, input)
    const before = structuredClone(useWorkbenchStore.getState().storyboardPlans['storyboard-doc']?.plan)
    const outcome = await applyProposalBatch(
      [{ toolCallId: 'tool-stale-patch', toolName: 'nomi_canvas_plan', effectiveArgs: input }],
      undefined,
      undefined,
      {
        proposalId: 'receipt-stale-patch',
        beforePrepare() {
          assertCanvasWriteAdmissionMatches(rawEvidence, {
            target: admission.target,
            preconditions: { edges: [{ relationHash: 'sha256-stale-revision' }] },
          }, input)
        },
      },
    )
    expect(outcome).toMatchObject({ status: 'aborted', proposalId: 'receipt-stale-patch' })
    expect(useWorkbenchStore.getState().storyboardPlans['storyboard-doc']?.plan).toEqual(before)
  })

})
