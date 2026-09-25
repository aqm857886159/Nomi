import { afterEach, describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { createDefaultTimeline } from '../timeline/timelineMath'
import { releaseWorkbenchProjectRuntimeState } from './releaseWorkbenchProjectSession'
import { useShotVerifyStore } from '../generationCanvas/agent/shotVerifyStore'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { clearActiveWorkbenchProjectSaveTarget, setActiveWorkbenchProjectSaveTarget } from './workbenchProjectSession'
import {
  getCommittedProposal,
  hydrateCommittedProposalReceipt,
} from '../generationCanvas/agent/proposalUndo'
import { laneClient } from '../ai/lane/laneClient'
import { DEFAULT_PROJECT_AGENT_APPROVAL_POLICY } from '../../../electron/shared/agentCapabilities/capabilityApprovalPolicy';

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
    laneClient.connect(undefined)
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

  it('keeps prompt and Skill references mutually exclusive and clears them across projects', () => {
    const prompt = { id: 'private-recipe', title: 'Recipe', prompt: 'Project A private direction', mediaUrl: '', mediaType: 'image' as const, promptType: 'image' as const, tags: [], source: '', sourceId: '', sourceUrl: '', origin: 'user' as const }
    useWorkbenchStore.getState().setCreationActiveSkill({ key: 'skill-a' })
    useWorkbenchStore.getState().setSelectedLibraryPrompt(prompt)
    expect(useWorkbenchStore.getState().creationActiveSkill).toBeNull()
    expect(useWorkbenchStore.getState().selectedLibraryPrompt).toEqual(prompt)
    useWorkbenchStore.getState().setCreationActiveSkill({ key: 'skill-b' })
    expect(useWorkbenchStore.getState().selectedLibraryPrompt).toBeNull()
    useWorkbenchStore.getState().setSelectedLibraryPrompt(prompt)
    releaseWorkbenchProjectRuntimeState()
    expect(useWorkbenchStore.getState().selectedLibraryPrompt).toBeNull()
  })

  it('resets the resident approval and spend policy when switching projects', () => {
    useWorkbenchStore.getState().setProjectAgentApprovalPolicy({ mode: 'project', spend: 'within-budget' })

    releaseWorkbenchProjectRuntimeState()

    expect(useWorkbenchStore.getState().projectAgentApprovalPolicy).toEqual(DEFAULT_PROJECT_AGENT_APPROVAL_POLICY)
  })

  it('clears only the in-memory proposal receipt view on project release', async () => {
    const binding = {
      projectId: 'project-A',
      immutableProjectUuid: '11111111-1111-4111-8111-111111111111',
      projectGeneration: 1,
    } as const
    laneClient.connect({
      onProjection: () => () => undefined,
      send: async command => {
        if (command.kind === 'workspace-open') return { ok: true, workspaceId: 'subscription-a' }
        throw new Error(`Project release must not mutate durable receipts: ${command.kind}`)
      },
    })
    await laneClient.open(binding)
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
      persist: async () => { throw new Error('not used') },
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
      persist: async () => { throw new Error('not used') },
      onSaved: () => undefined,
    }
    setActiveWorkbenchProjectSaveTarget(target)
    const request = useShotVerifyStore.getState().beginVerify('project-A')

    clearActiveWorkbenchProjectSaveTarget('project-A')
    setActiveWorkbenchProjectSaveTarget(target)

    expect(useShotVerifyStore.getState().isVerifyCurrent(request, 'project-A')).toBe(true)
  })
})

/**
 * C1（2026-09-18）：审计 §9 把 `useSpendConfirmStore` 点名为「最值得先做真机的一条，涉钱」。
 * 这两条断言先把它的两种坏法钉住——真机切项目那一遍在 PR 正文里。
 */
describe('C1 · 付费待确认卡的寿命归项目会话', () => {
  it('切项目后上一个项目的付费卡不会留在新项目里', () => {
    const decision = useSpendConfirmStore.getState().requestConfirm({
      title: '开始生成', message: '本次约 0.3 元', nodeIds: ['n1'],
    } as never)
    expect(useSpendConfirmStore.getState().pending).not.toBeNull()
    releaseWorkbenchProjectRuntimeState()
    expect(useSpendConfirmStore.getState().pending).toBeNull()
    expect(useSpendConfirmStore.getState().queue).toEqual([])
    return expect(decision).resolves.toBe(false)
  })

  it('释放不是简单置空：等着答复的那一方会拿到「没确认」，不会永远挂着', async () => {
    const first = useSpendConfirmStore.getState().requestConfirm({ title: 'A', message: 'A', nodeIds: ['a'] } as never)
    const queued = useSpendConfirmStore.getState().requestConfirm({ title: 'B', message: 'B', nodeIds: ['b'] } as never)
    expect(useSpendConfirmStore.getState().queue).toHaveLength(1)
    releaseWorkbenchProjectRuntimeState()
    // 队首和排队的都要被回绝。少 resolve 任何一个，那次生成就停在「等待确认」永远不返回。
    await expect(Promise.all([first, queued])).resolves.toEqual([false, false])
  })
})
