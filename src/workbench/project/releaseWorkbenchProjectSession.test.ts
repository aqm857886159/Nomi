import { afterEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultTimeline } from '../timeline/timelineMath'
import { releaseWorkbenchProjectRuntimeState } from './releaseWorkbenchProjectSession'
import { useShotVerifyStore } from '../generationCanvas/agent/shotVerifyStore'
import { clearActiveWorkbenchProjectSaveTarget, setActiveWorkbenchProjectSaveTarget } from './workbenchProjectSession'
import {
  getCommittedProposal,
  hydrateCommittedProposalReceipt,
} from '../generationCanvas/agent/proposalUndo'
import { projectAgentProjectionStore } from '../ai/projectAgentProjectionStore'
import { createInitialProjectAgentState } from '../../../electron/projectAgentHost/projectAgentState'
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from '../../../electron/shared/projectAgentContracts'

function node(id: string): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    prompt: '',
    position: { x: 0, y: 0 },
  } as GenerationCanvasNode
}

describe('releaseWorkbenchProjectRuntimeState', () => {
  afterEach(() => {
    clearActiveWorkbenchProjectSaveTarget()
    releaseWorkbenchProjectRuntimeState()
  })

  it('clears heavy project state without resetting store actions', () => {
    const addNode = useGenerationCanvasStore.getState().addNode
    useGenerationCanvasStore.setState({
      isReady: true,
      nodes: [node('n1')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      groups: [{ id: 'g1', name: 'Group', categoryId: 'shots', nodeIds: ['n1'], createdAt: 0, updatedAt: 0 }],
      selectedNodeIds: ['n1'],
      hasClipboard: true,
    })
    useWorkbenchStore.setState({
      storyboardDesignsByDocumentId: {
        'doc-a': [{
          id: 'storyboard-a', documentId: 'doc-a', title: 'plan',
          plan: { title: 'plan', anchors: [], shots: [] }, committed: true, status: 'committed',
          sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1,
        }],
      },
      activeStoryboardId: 'storyboard-a',
      timeline: { ...createDefaultTimeline(), playheadFrame: 24 },
      selectedTimelineClipIds: ['clip1'],
      timelineUndoStack: [createDefaultTimeline()],
    })
    const verifyRequest = useShotVerifyStore.getState().beginVerify('project-A')
    useShotVerifyStore.getState().setDeviations([{
      where: '镜头 1',
      field: '身份',
      expected: '一致',
      actual: '不一致',
      kind: 'content',
      shotNodeId: 'n1',
    }])

    releaseWorkbenchProjectRuntimeState()

    const canvas = useGenerationCanvasStore.getState()
    expect(canvas.nodes).toEqual([])
    expect(canvas.edges).toEqual([])
    expect(canvas.groups).toEqual([])
    expect(canvas.selectedNodeIds).toEqual([])
    expect(canvas.addNode).toBe(addNode)

    const workbench = useWorkbenchStore.getState()
    expect(workbench.storyboardDesignsByDocumentId).toEqual({})
    expect(workbench.storyboardDesignsByDocumentId).toEqual({})
    expect(workbench.activeStoryboardId).toBeNull()
    expect(workbench.timeline).toEqual(createDefaultTimeline())
    expect(workbench.selectedTimelineClipIds).toEqual([])
    expect(workbench.timelineUndoStack).toEqual([])

    const verify = useShotVerifyStore.getState()
    expect(verify.projectId).toBeNull()
    expect(verify.status).toBe('idle')
    expect(verify.deviations).toEqual([])
    expect(verify.requestId).toBeGreaterThan(verifyRequest.requestId)
  })

  it('resets the resident approval and spend policy when switching projects', () => {
    useWorkbenchStore.getState().setProjectAgentApprovalPolicy({ mode: 'project', spend: 'within-budget' })

    releaseWorkbenchProjectRuntimeState()

    expect(useWorkbenchStore.getState().projectAgentApprovalPolicy).toEqual(DEFAULT_PROJECT_AGENT_APPROVAL_POLICY)
  })

  it('clears only the in-memory proposal receipt view on project release', () => {
    const binding = {
      projectId: 'project-A',
      immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
      projectGeneration: 1,
    } as const
    projectAgentProjectionStore.install('subscription-a', 1, createInitialProjectAgentState(binding))
    hydrateCommittedProposalReceipt({
      binding,
      revision: 2,
      lifecycle: 'committed',
      proposalId: 'proposal-a',
      operationId: 'proposal-commit:proposal-a',
      proposal: {
        proposalId: 'proposal-a',
        summary: 'created node',
        stepLabels: ['created node'],
        compensation: [{ kind: 'delete-nodes', nodeIds: ['node-a'] }],
        watchNodes: [],
        reconciliationOk: true,
      },
    })
    expect(getCommittedProposal()?.proposalId).toBe('proposal-a')

    releaseWorkbenchProjectRuntimeState()

    expect(getCommittedProposal()).toBeNull()
  })

  it('active project owner switches shot verify scope before an old result can surface', () => {
    const target = (projectId: string) => ({
      projectId,
      projectName: projectId,
      canPersist: () => false,
      saveProject: async () => { throw new Error('not used') },
      onSaved: () => undefined,
    })
    setActiveWorkbenchProjectSaveTarget(target('project-A'))
    const oldRequest = useShotVerifyStore.getState().beginVerify('project-A')
    useShotVerifyStore.getState().setDeviations([{
      where: 'A 镜头',
      field: '身份',
      expected: '一致',
      actual: '不一致',
      kind: 'content',
    }])

    setActiveWorkbenchProjectSaveTarget(target('project-B'))

    const verify = useShotVerifyStore.getState()
    expect(verify.projectId).toBe('project-B')
    expect(verify.status).toBe('idle')
    expect(verify.deviations).toEqual([])
    expect(verify.requestId).toBeGreaterThan(oldRequest.requestId)
  })

  it('persistence subscription rebind does not invalidate an in-flight verify for the same project', () => {
    const target = {
      projectId: 'project-A',
      projectName: 'project-A',
      canPersist: () => false,
      saveProject: async () => { throw new Error('not used') },
      onSaved: () => undefined,
    }
    setActiveWorkbenchProjectSaveTarget(target)
    const request = useShotVerifyStore.getState().beginVerify('project-A')

    clearActiveWorkbenchProjectSaveTarget('project-A')
    setActiveWorkbenchProjectSaveTarget(target)

    expect(useShotVerifyStore.getState().isVerifyCurrent(request, 'project-A')).toBe(true)
  })
})
